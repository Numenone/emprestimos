import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config(); // Carrega variáveis do .env

const prisma = new PrismaClient();
const router = Router();

// Configuração do Mailtrap (deve estar no escopo global)
const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS
  }
});

// Schema para validação
const emprestimoSchema = z.object({
  alunoId: z.number().int().positive(),
  livroId: z.number().int().positive(),
  dataDevolucao: z.coerce.date().min(new Date())
});


// Rota GET para listar todos os empréstimos (ADICIONADA AQUI)
router.get("/", async (req, res) => {
  try {
    const emprestimos = await prisma.emprestimo.findMany({
      include: {
        aluno: true,
        livro: true
      },
      orderBy: {
        dataEmprestimo: 'desc'
      }
    });
    res.status(200).json(emprestimos);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar empréstimos" });
  }
});

// Registrar empréstimo
router.post("/", async (req, res) => {
  const valida = emprestimoSchema.safeParse(req.body);
  if (!valida.success) {
    return res.status(400).json({ error: valida.error });
  }

  try {
    const [emprestimo, livroAtualizado] = await prisma.$transaction([
      prisma.emprestimo.create({
        data: {
          alunoId: valida.data.alunoId,
          livroId: valida.data.livroId,
          dataDevolucao: valida.data.dataDevolucao
        },
        include: {
          aluno: true,
          livro: true
        }
      }),
      prisma.livro.update({
        where: { id: valida.data.livroId },
        data: { quantidade: { decrement: 1 } }
      })
    ]);

    res.status(201).json(emprestimo);
  } catch (error) {
    res.status(500).json({ error: "Erro ao registrar empréstimo" });
  }
});

// Devolução de livro
router.delete("/:id", async (req, res) => {
  try {
    const emprestimo = await prisma.emprestimo.findUnique({
      where: { id: Number(req.params.id) }
    });

    if (!emprestimo) {
      return res.status(404).json({ error: "Empréstimo não encontrado" });
    }

    const [result, livroAtualizado] = await prisma.$transaction([
      prisma.emprestimo.update({
        where: { id: Number(req.params.id) },
        data: { devolvido: true }
      }),
      prisma.livro.update({
        where: { id: emprestimo.livroId },
        data: { quantidade: { increment: 1 } }
      })
    ]);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Erro ao processar devolução" });
  }
});

// Enviar e-mail com histórico
router.post('/:id/email', async (req, res) => {
  try {
    const aluno = await prisma.aluno.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        emprestimos: {
          where: { devolvido: false },
          include: { livro: true }
        }
      }
    });

    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    const html = `
      <h1>Histórico de Empréstimos</h1>
      <p>Aluno: ${aluno.nome}</p>
      ${aluno.emprestimos.map(emp => `
        <p>Livro: ${emp.livro.titulo} (Devolução: ${emp.dataDevolucao.toLocaleDateString('pt-BR')})</p>
      `).join('')}
    `;

    // Agora o transporter está acessível
    await transporter.sendMail({
      from: '"Biblioteca" <no-reply@biblioteca.com>',
      to: aluno.email,
      subject: 'Seu histórico de empréstimos',
      html
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    res.status(500).json({ error: 'Erro ao enviar e-mail' });
  }
});

export default router;