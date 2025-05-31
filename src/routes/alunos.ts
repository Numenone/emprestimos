import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const router = Router();

const alunoSchema = z.object({
  nome: z.string().min(3),
  email: z.string().email(),
  matricula: z.string().min(5)
});

const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS
  }
});

// GET todos os alunos
router.get("/", async (req, res) => {
  try {
    const alunos = await prisma.aluno.findMany();
    res.json(alunos);
  } catch (error) {
    res.status(500).json({ 
      error: "Erro ao buscar alunos",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// POST criar aluno
router.post("/", async (req, res) => {
  console.log('Dados recebidos no backend:', req.body);
  
  const valida = alunoSchema.safeParse(req.body);
  
  if (!valida.success) {
    console.log('Erro de validação:', valida.error.errors);
    return res.status(400).json({ 
      error: "Dados inválidos",
      details: valida.error.errors.map(e => `${e.path}: ${e.message}`).join(', ')
    });
  }

  try {
    const aluno = await prisma.aluno.create({ 
      data: valida.data 
    });
    res.status(201).json(aluno);
  } catch (error) {
    console.error('Erro no banco de dados:', error);
    res.status(400).json({
      error: "Erro ao criar aluno",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// PUT atualizar aluno completo
router.put("/:id", async (req, res) => {
  const valida = alunoSchema.safeParse(req.body);
  
  if (!valida.success) {
    return res.status(400).json({ 
      error: "Dados inválidos",
      details: valida.error.errors
    });
  }

  try {
    const aluno = await prisma.aluno.update({
      where: { id: Number(req.params.id) },
      data: valida.data
    });
    res.status(200).json(aluno);
  } catch (error) {
    res.status(500).json({ 
      error: "Erro ao atualizar aluno",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// PATCH atualizar parcialmente aluno
router.patch("/:id", async (req, res) => {
  try {
    const aluno = await prisma.aluno.update({
      where: { id: Number(req.params.id) },
      data: req.body
    });
    res.status(200).json(aluno);
  } catch (error) {
    res.status(500).json({ 
      error: "Erro ao atualizar aluno",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// POST enviar e-mail com empréstimos ativos
router.post("/:id/email", async (req, res) => {
  try {
    const aluno = await prisma.aluno.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        emprestimos: {
          where: { devolvido: false },
          include: { livro: true },
          orderBy: { dataDevolucao: 'asc' }
        }
      }
    });

    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    if (aluno.emprestimos.length === 0) {
      return res.json({ 
        message: 'Aluno não possui empréstimos ativos',
        alunoId: aluno.id
      });
    }

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

    const info = await transporter.sendMail({
      from: process.env.MAILTRAP_FROM || '"Biblioteca" <biblioteca@example.com>',
      to: aluno.email,
      subject: `[Biblioteca] Empréstimos Ativos - ${aluno.nome}`,
      html: html
    });

    console.log('E-mail enviado:', info.messageId);

    res.json({
      success: true,
      message: `E-mail enviado para ${aluno.email}`,
      emprestimos: aluno.emprestimos.length
    });

  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({
      error: 'Falha ao enviar e-mail',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;