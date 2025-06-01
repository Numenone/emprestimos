import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Request, Response } from "express";


dotenv.config();

const prisma = new PrismaClient();
const router = Router();

const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
  port: parseInt(process.env.MAILTRAP_PORT || "2525"),
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS
  }
});

// Schemas de validação
const EmprestimoSchema = {
  create: z.object({
    alunoId: z.number().int().positive("ID do aluno inválido"),
    livroId: z.number().int().positive("ID do livro inválido"),
    dataDevolucao: z.string().refine(date => {
      return !isNaN(Date.parse(date));
    }, {
      message: "Data de devolução inválida (use formato YYYY-MM-DD)"
    })
  }),
  update: z.object({
    alunoId: z.number().int().positive("ID do aluno inválido").optional(),
    livroId: z.number().int().positive("ID do livro inválido").optional(),
    dataDevolucao: z.string().datetime({ offset: true }).optional()
  })
};

// Helper para tratamento de erros
const handleError = (res: any, error: unknown, context: string) => {
  console.error(`Erro em ${context}:`, error);
  const message = error instanceof Error ? error.message : 'Erro desconhecido';
  res.status(500).json({ 
    success: false,
    error: `Erro ao ${context}`,
    details: message
  });
};

// POST - Criar empréstimo
router.post("/", async (req: Request, res: Response) => {
  const validation = EmprestimoSchema.create.safeParse(req.body);
  
  if (!validation.success) {
    return res.status(400).json({ 
      success: false,
      error: validation.error.errors.map(e => e.message).join(', ')
    });
  }

  try {
    const { alunoId, livroId, dataDevolucao } = validation.data;
    const dataDevolucaoObj = new Date(dataDevolucao);

    // Verificação adicional
    console.log('Verificando disponibilidade...');
    const livro = await prisma.livro.findUnique({ where: { id: livroId } });
    if (!livro || livro.quantidade <= 0) {
      console.log('Livro não disponível');
      return res.status(400).json({ 
        success: false, 
        error: "Livro não disponível" 
      });
    }

    // Transação
    console.log('Iniciando transação...');
const [novoEmprestimo] = await prisma.$transaction([
  prisma.emprestimo.create({
    data: {
      alunoId,
      livroId,
      dataEmprestimo: new Date(),
      dataDevolucao: dataDevolucaoObj,
      devolvido: false,
      // createdAt e updatedAt serão preenchidos automaticamente
    },
    include: {
      aluno: { select: { nome: true } },
      livro: { select: { titulo: true } }
    }
  }),
  prisma.livro.update({
    where: { id: livroId },
    data: { quantidade: { decrement: 1 } }
  })
]);

    console.log('Empréstimo criado:', novoEmprestimo);
    res.status(201).json({ success: true, emprestimo: novoEmprestimo });
  } catch (error) {
    handleError(res, error, "criar empréstimo");
  }
});

// GET - Listar empréstimos ativos
router.get("/", async (req: Request, res: Response) => {
  try {
    const emprestimos = await prisma.emprestimo.findMany({
      where: { devolvido: false },
      include: {
        aluno: { select: { nome: true, email: true } },
        livro: { select: { titulo: true, autor: true } }
      },
      orderBy: { dataEmprestimo: 'desc' }
    });

    res.status(200).json(emprestimos);
  } catch (error) {
    handleError(res, error, "listar empréstimos");
  }
});

// DELETE - Devolver livro
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const emprestimo = await prisma.emprestimo.findUnique({
      where: { id: Number(req.params.id) },
      include: { livro: true }
    });

    if (!emprestimo) {
      return res.status(404).json({ success: false, error: "Empréstimo não encontrado" });
    }

    if (emprestimo.devolvido) {
      return res.status(400).json({ success: false, error: "Livro já devolvido" });
    }

    const [_, livroAtualizado] = await prisma.$transaction([
      prisma.emprestimo.update({
        where: { id: Number(req.params.id) },
        data: { devolvido: true }
      }),
      prisma.livro.update({
        where: { id: emprestimo.livroId },
        data: { quantidade: { increment: 1 } }
      })
    ]);

    res.json({ 
      success: true,
      message: "Devolução registrada com sucesso",
      livro: { 
        id: livroAtualizado.id, 
        titulo: livroAtualizado.titulo,
        quantidade: livroAtualizado.quantidade
      }
    });
  } catch (error) {
    handleError(res, error, "registrar devolução");
  }
});

// PUT - Atualizar empréstimo completo
router.put("/:id", async (req: Request, res: Response) => {
  const validation = EmprestimoSchema.create.safeParse(req.body);
  
  if (!validation.success) {
    return res.status(400).json({ 
      success: false,
      error: validation.error.errors.map(e => e.message).join(', ')
    });
  }

  try {
    const emprestimo = await prisma.emprestimo.update({
      where: { id: Number(req.params.id) },
      data: {
        alunoId: validation.data.alunoId,
        livroId: validation.data.livroId,
        dataDevolucao: new Date(validation.data.dataDevolucao)
      },
      include: {
        aluno: { select: { nome: true } },
        livro: { select: { titulo: true } }
      }
    });
    
    res.status(200).json({ success: true, emprestimo });
  } catch (error) {
    handleError(res, error, "atualizar empréstimo");
  }
});

// PATCH - Atualizar parcialmente empréstimo
router.patch("/:id", async (req: Request, res: Response) => {
  const validation = EmprestimoSchema.update.safeParse(req.body);
  
  if (!validation.success) {
    return res.status(400).json({ 
      success: false,
      error: validation.error.errors.map(e => e.message).join(', ')
    });
  }

  try {
    // Criar objeto de atualização
    const updateData: any = {};
    
    if (validation.data.alunoId !== undefined) {
      updateData.alunoId = validation.data.alunoId;
    }
    
    if (validation.data.livroId !== undefined) {
      updateData.livroId = validation.data.livroId;
    }
    
    if (validation.data.dataDevolucao !== undefined) {
      updateData.dataDevolucao = new Date(validation.data.dataDevolucao);
    }

    const emprestimo = await prisma.emprestimo.update({
      where: { id: Number(req.params.id) },
      data: updateData,
      include: {
        aluno: { select: { nome: true } },
        livro: { select: { titulo: true } }
      }
    });
    
    res.status(200).json({ success: true, emprestimo });
  } catch (error) {
    handleError(res, error, "atualizar empréstimo");
  }
});

// POST - Enviar e-mail com empréstimos ativos
router.post('/:id/email', async (req: Request, res: Response) => {
  try {
    const aluno = await prisma.aluno.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        emprestimos: {
          where: { devolvido: false },
          include: { 
            livro: { select: { titulo: true, autor: true } }
          },
          orderBy: { dataDevolucao: 'asc' }
        }
      }
    });

    if (!aluno) {
      return res.status(404).json({ success: false, error: "Aluno não encontrado" });
    }

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #2c3e50;">Histórico de Empréstimos Ativos</h2>
        <p>Aluno: <strong>${aluno.nome}</strong> (${aluno.email})</p>
        ${aluno.emprestimos.length > 0 ? `
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <thead>
              <tr style="background-color: #f2f2f2;">
                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Livro</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Autor</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Data Devolução</th>
              </tr>
            </thead>
            <tbody>
              ${aluno.emprestimos.map(emp => `
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd;">${emp.livro.titulo}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${emp.livro.autor}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;">
                   ${emp.dataDevolucao ? new Date(emp.dataDevolucao).toLocaleDateString('pt-BR') : 'Pendente'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p style="margin-top: 15px;">Nenhum empréstimo ativo no momento.</p>'}
      </div>
    `;

    await transporter.sendMail({
      from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
      to: aluno.email,
      subject: `Seus empréstimos ativos - ${aluno.nome}`,
      html
    });

    res.json({ 
      success: true,
      message: 'E-mail enviado com sucesso',
      destinatario: aluno.email,
      totalEmprestimos: aluno.emprestimos.length
    });
  } catch (error) {
    handleError(res, error, "enviar e-mail");
  }
});

export default router;