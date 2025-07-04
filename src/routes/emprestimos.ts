import { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateJWT } from '../auth/jwt';

const prisma = new PrismaClient();
const router = Router();

router.use(authenticateJWT);

const emprestimoSchema = z.object({
  alunoId: z.number().int().positive(),
  livroId: z.number().int().positive(),
  dataDevolucao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

// POST criar empréstimo
router.post("/", async (req: Request, res: Response) => {
  const validation = emprestimoSchema.safeParse(req.body);
  
  if (!validation.success) {
    return res.status(400).json({ 
      error: "Dados inválidos",
      details: validation.error.errors 
    });
  }

  try {
    const { alunoId, livroId, dataDevolucao } = validation.data;

    // Verificar se aluno existe e está ativo
    const aluno = await prisma.aluno.findUnique({
      where: { id: alunoId, deleted: false, status: 'ATIVO', bloqueado: false }
    });

    if (!aluno) {
      return res.status(400).json({ error: 'Aluno não encontrado ou inativo' });
    }

    // Verificar se livro existe e está disponível
    const livro = await prisma.livro.findUnique({
      where: { id: livroId, deleted: false }
    });

    if (!livro || livro.quantidade <= 0) {
      return res.status(400).json({ error: 'Livro não disponível' });
    }

    // Criar empréstimo e atualizar quantidade
    const [emprestimo] = await prisma.$transaction([
      prisma.emprestimo.create({
        data: {
          alunoId,
          livroId,
          dataEmprestimo: new Date(),
          dataDevolucao: new Date(dataDevolucao),
          devolvido: false
        }
      }),
      prisma.livro.update({
        where: { id: livroId },
        data: { quantidade: { decrement: 1 } }
      })
    ]);

    res.status(201).json({ success: true, emprestimo });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar empréstimo' });
  }
});

// GET - List active loans with pagination
router.get("/", async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const skip = (page - 1) * pageSize;

  try {
    const [emprestimos, total] = await Promise.all([
      prisma.emprestimo.findMany({
        where: { devolvido: false },
        include: {
          aluno: { select: { nome: true, email: true } },
          livro: { select: { titulo: true, autor: true } }
        },
        orderBy: { dataEmprestimo: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.emprestimo.count({ where: { devolvido: false } })
    ]);

    res.status(200).json({
      data: emprestimos,
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    handleError(res, error, "listar empréstimos");
  }
});

// DELETE - Return book
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const emprestimo = await prisma.emprestimo.findUnique({
      where: { id: Number(req.params.id) },
      include: { livro: true }
    });

    if (!emprestimo) {
      return res.status(404).json({ 
        success: false, 
        error: "Empréstimo não encontrado" 
      });
    }

    if (emprestimo.devolvido) {
      return res.status(400).json({ 
        success: false, 
        error: "Livro já devolvido" 
      });
    }

    const [_, livroAtualizado] = await prisma.$transaction([
      prisma.emprestimo.update({
        where: { id: Number(req.params.id) },
        data: { 
          devolvido: true,
          dataDevolucao: new Date() // Set return date to now
        }
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

// PUT - Full update loan
router.put("/:id", async (req: Request, res: Response) => {
  const validation = EmprestimoSchema.create.safeParse(req.body);
  
  if (!validation.success) {
    return res.status(400).json({ 
      success: false,
      error: validation.error.errors.map(e => e.message).join(', ')
    });
  }

  try {
    // Verify loan exists
    const exists = await prisma.emprestimo.findUnique({
      where: { id: Number(req.params.id) }
    });
    if (!exists) {
      return res.status(404).json({ 
        success: false, 
        error: "Empréstimo não encontrado" 
      });
    }

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

// PATCH - Partial update loan
router.patch("/:id", async (req: Request, res: Response) => {
  const validation = EmprestimoSchema.update.safeParse(req.body);
  
  if (!validation.success) {
    return res.status(400).json({ 
      success: false,
      error: validation.error.errors.map(e => e.message).join(', ')
    });
  }

  try {
    // Verify loan exists
    const exists = await prisma.emprestimo.findUnique({
      where: { id: Number(req.params.id) }
    });
    if (!exists) {
      return res.status(404).json({ 
        success: false, 
        error: "Empréstimo não encontrado" 
      });
    }

    const updateData: Partial<Emprestimo> = {};
    
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

// POST - Send email with active loans (with rate limiting)
router.post('/:id/email', emailRateLimiter, async (req: Request, res: Response) => {
  try {
    const aluno = await prisma.aluno.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        emprestimos: {
          where: { devolvido: false },
          include: { 
            // Incluindo todos os campos necessários para o tipo Livro
            livro: { select: { id: true, titulo: true, autor: true, quantidade: true } }
          },
          orderBy: { dataDevolucao: 'asc' }
        }
      }
    });

    if (!aluno) {
      return res.status(404).json({ 
        success: false, 
        error: "Aluno não encontrado" 
      });
    }

    const html = generateEmailHtml(aluno);

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
      to: aluno.email,
      subject: `Seus empréstimos ativos - ${aluno.nome}`,
      html
    });

    console.log('Email sent:', info.messageId);

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

// Helper function to generate email HTML
function generateEmailHtml(aluno: Aluno & { emprestimos: (Emprestimo & { livro: Livro | null })[] }): string {
  return `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2 style="color: #2c3e50;">Histórico de Empréstimos Ativos</h2>
      <p>Aluno: <strong>${aluno.nome}</strong> (${aluno.email})</p>
      ${aluno.emprestimos.length > 0 ? `
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Livro</th>
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Autor</th>
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Data Empréstimo</th>
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Data Devolução</th>
            </tr>
          </thead>
          <tbody>
            ${aluno.emprestimos.map(emp => `
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">${emp.livro?.titulo || 'Livro não encontrado'}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${emp.livro?.autor || 'N/A'}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${emp.dataEmprestimo.toLocaleDateString('pt-BR')}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">
                  ${emp.dataDevolucao ? emp.dataDevolucao.toLocaleDateString('pt-BR') : 'Pendente'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p style="margin-top: 15px;">Nenhum empréstimo ativo no momento.</p>'}
      <p style="margin-top: 20px; font-size: 0.9em; color: #666;">
        Esta é uma mensagem automática, por favor não responda.
      </p>
    </div>
  `;
}

// Proper shutdown handling
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export default router;