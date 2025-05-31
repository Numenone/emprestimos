import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config(); // Carrega variáveis do .env

const prisma = new PrismaClient();
const router = Router();

// Schema de validação
const alunoSchema = z.object({
  nome: z.string().min(3),
  email: z.string().email(),
  matricula: z.string().min(5)
});

// Configuração do Mailtrap
const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS
  }
});

// Rota GET para listar alunos
router.get("/", async (req, res) => {
  try {
    const alunos = await prisma.aluno.findMany();
    res.json(alunos);
  } catch (error) {
    res.status(500).json({ error });
  }
});

// Rota POST para criar aluno
router.post("/", async (req, res) => {
  const valida = alunoSchema.safeParse(req.body);
  if (!valida.success) {
    return res.status(400).json({ error: valida.error });
  }

  try {
    const aluno = await prisma.aluno.create({ data: valida.data });
    res.status(201).json(aluno);
  } catch (error) {
    res.status(400).json({ error });
  }
});

router.post('/:id/email', async (req, res) => {
  try {
    // 1. Busca o aluno com seus empréstimos ATIVOS (não devolvidos)
    const aluno = await prisma.aluno.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        emprestimos: {
          where: { 
            devolvido: false // Filtra apenas empréstimos ativos
          },
          include: { 
            livro: true // Inclui os dados completos do livro
          },
          orderBy: {
            dataDevolucao: 'asc' // Ordena por data de devolução
          }
        }
      }
    });

    // 2. Verifica se o aluno existe
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    // 3. Verifica se há empréstimos ativos
    if (aluno.emprestimos.length === 0) {
      return res.json({ 
        message: 'Aluno não possui empréstimos ativos no momento',
        alunoId: aluno.id
      });
    }

    // 4. Gera o conteúdo do e-mail (com verificação adicional)
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #2c3e50;">Histórico de Empréstimos Ativos</h2>
        <p>Aluno: <strong>${aluno.nome}</strong> (Matrícula: ${aluno.matricula})</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f8f9fa;">
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Livro</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Autor</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Empréstimo</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Devolução</th>
            </tr>
          </thead>
          <tbody>
            ${aluno.emprestimos.map(emp => {
              // Verificação adicional para garantir que o livro existe
              const livro = emp.livro || { titulo: 'Livro não encontrado', autor: 'N/A' };
              return `
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.titulo}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.autor}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;">${new Date(emp.dataEmprestimo).toLocaleDateString('pt-BR')}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;">${new Date(emp.dataDevolucao).toLocaleDateString('pt-BR')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // 5. Envia o e-mail
    const info = await transporter.sendMail({
      from: process.env.MAILTRAP_FROM,
      to: aluno.email,
      subject: `[Biblioteca] Empréstimos Ativos - ${aluno.nome}`,
      html: html
    });

    // 6. Log para debug (opcional)
    console.log('E-mail enviado para Mailtrap:', {
      alunoId: aluno.id,
      totalEmprestimos: aluno.emprestimos.length,
      mailtrapId: info.messageId
    });

    res.json({
      success: true,
      message: `E-mail com ${aluno.emprestimos.length} empréstimos enviado para ${aluno.email}`,
      mailtrapUrl: "https://mailtrap.io/inboxes"
    });

  } catch (error) {
    console.error('Erro detalhado:', error);
    res.status(500).json({
      error: 'Falha ao enviar e-mail',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;