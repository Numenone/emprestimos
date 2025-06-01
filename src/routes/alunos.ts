import { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

// Interfaces para melhor tipagem
interface Aluno {
  id: number;
  nome: string;
  email: string;
  matricula: string;
}

interface Livro {
  id: number;
  titulo: string;
  autor: string;
  quantidade: number;
}

interface EmprestimoComLivro {
  id: number;
  dataEmprestimo: Date;
  dataDevolucao: Date | null;
  devolvido: boolean;
  livro: Livro | null;
}

const prisma = new PrismaClient();
const router = Router();

// Rate limiting para endpoint de email
const emailRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // máximo 5 requisições por IP nesse período
  message: 'Muitas requisições de email desse IP, tente novamente mais tarde'
});

// Validação com Zod
const alunoSchema = z.object({
  nome: z.string().min(3, { message: "Nome deve ter pelo menos 3 caracteres" }),
  email: z.string().email({ message: "Email inválido" }),
  matricula: z.string().min(5, { message: "Matrícula deve ter pelo menos 5 caracteres" })
});

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
  port: parseInt(process.env.MAILTRAP_PORT || "2525"),
  auth: {
    user: process.env.MAILTRAP_USER || '',
    pass: process.env.MAILTRAP_PASS || ''
  }
});

// GET todos os alunos com paginação
router.get("/", async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const skip = (page - 1) * pageSize;

  try {
    const [alunos, total] = await Promise.all([
      prisma.aluno.findMany({
        skip,
        take: pageSize,
        orderBy: { nome: 'asc' }
      }),
      prisma.aluno.count()
    ]);

    res.json({
      data: alunos,
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ 
      error: "Erro ao buscar alunos",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// POST criar aluno
router.post("/", async (req: Request, res: Response) => {
  console.log('Dados recebidos no backend:', req.body);
  
  const valida = alunoSchema.safeParse(req.body);
  
  if (!valida.success) {
    console.log('Erro de validação:', valida.error.errors);
    return res.status(400).json({ 
      error: "Dados inválidos",
      details: valida.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
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

// PUT atualizar aluno inteiro
router.put("/:id", async (req: Request, res: Response) => {
  const valida = alunoSchema.safeParse(req.body);
  
  if (!valida.success) {
    return res.status(400).json({ 
      error: "Dados inválidos",
      details: valida.error.errors
    });
  }

  try {
    const exists = await prisma.aluno.findUnique({
      where: { id: Number(req.params.id) }
    });
    
    if (!exists) {
      return res.status(404).json({ error: "Aluno não encontrado" });
    }

    const aluno = await prisma.aluno.update({
      where: { id: Number(req.params.id) },
      data: valida.data
    });
    res.status(200).json(aluno);
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({ 
      error: "Erro ao atualizar aluno",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// PATCH atualizar parcialmente o aluno
router.patch("/:id", async (req: Request, res: Response) => {
  const partialAlunoSchema = alunoSchema.partial();
  const valida = partialAlunoSchema.safeParse(req.body);

  if (!valida.success) {
    return res.status(400).json({
      error: "Dados inválidos",
      details: valida.error.errors
    });
  }

  try {
    const exists = await prisma.aluno.findUnique({
      where: { id: Number(req.params.id) }
    });
    
    if (!exists) {
      return res.status(404).json({ error: "Aluno não encontrado" });
    }

    const aluno = await prisma.aluno.update({
      where: { id: Number(req.params.id) },
      data: valida.data
    });
    res.status(200).json(aluno);
  } catch (error) {
    console.error('Error partially updating student:', error);
    res.status(500).json({ 
      error: "Erro ao atualizar aluno",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// POST enviar email com empréstimos ativos (com rate limiting)
router.post("/:id/email", emailRateLimiter, async (req: Request, res: Response) => {
  try {
    const aluno = await prisma.aluno.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        emprestimos: {
          where: { devolvido: false },
          include: { 
            livro: { select: { id: true, titulo: true, autor: true, quantidade: true } }
          },
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

    const emailHtml = generateEmailHtml(aluno);

    const mailOptions = {
      from: process.env.MAILTRAP_FROM || '"Biblioteca" <biblioteca@example.com>',
      to: aluno.email,
      subject: `[Biblioteca] Empréstimos Ativos - ${aluno.nome}`,
      html: emailHtml
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('E-mail enviado:', info.messageId);

    res.json({
      success: true,
      message: `E-mail enviado para ${aluno.email}`,
      emprestimos: aluno.emprestimos.length
    });

  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    res.status(500).json({
      error: 'Falha ao enviar e-mail',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Função auxiliar para gerar HTML do email
function generateEmailHtml(aluno: Aluno & { emprestimos: EmprestimoComLivro[] }): string {
  return `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2 style="color: #2c3e50;">Histórico de Empréstimos Ativos</h2>
      <p>Aluno: <strong>${aluno.nome}</strong> (Matrícula: ${aluno.matricula})</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <thead>
          <tr style="background-color: #f8f9fa;">
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Livro</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Autor</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Quantidade</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Empréstimo</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Devolução</th>
          </tr>
        </thead>
        <tbody>
          ${aluno.emprestimos.map(emp => {
            const livro = emp.livro ?? { titulo: 'Livro não encontrado', autor: 'N/A', quantidade: 0 };
            return `
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.titulo}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.autor}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.quantidade}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${new Date(emp.dataEmprestimo).toLocaleDateString('pt-BR')}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">
                  ${emp.dataDevolucao ? new Date(emp.dataDevolucao).toLocaleDateString('pt-BR') : 'Pendente'}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Encerramento correto do Prisma
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export default router;
