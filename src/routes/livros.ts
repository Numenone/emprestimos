// src/routes/livros.ts
import { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateJWT, checkPermission } from '../auth/jwt';

const prisma = new PrismaClient();
const router = Router();

router.use(authenticateJWT);

const livroSchema = z.object({
  titulo: z.string().min(3),
  autor: z.string().min(3),
  quantidade: z.number().int().positive()
});

// GET todos os livros (não deletados)
router.get("/", async (req: Request, res: Response) => {
  try {
    const livros = await prisma.livro.findMany({
      where: { deleted: false },
      orderBy: { titulo: 'asc' }
    });
    res.json({ success: true, livros });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar livros' });
  }
});

// POST criar livro (apenas admin)
router.post("/", checkPermission(2), async (req: Request, res: Response) => {
  const validation = livroSchema.safeParse(req.body);
  
  if (!validation.success) {
    return res.status(400).json({ 
      error: "Dados inválidos",
      details: validation.error.errors 
    });
  }

  try {
    const livro = await prisma.livro.create({
      data: validation.data
    });

    res.status(201).json({ success: true, livro });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar livro' });
  }
});

// DELETE livro (soft delete, apenas admin)
router.delete("/:id", checkPermission(3), async (req: Request, res: Response) => {
  try {
    const livro = await prisma.livro.update({
      where: { id: Number(req.params.id) },
      data: { 
        deleted: true,
        deletedAt: new Date()
      }
    });

    res.json({ 
      success: true, 
      message: 'Livro marcado como excluído com sucesso' 
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir livro' });
  }
});

// PUT atualizar livro completo
router.put("/:id", async (req: Request<{ id: string }, {}, LivroRequestBody>, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "ID inválido" });
  }

  try {
    const quantidade = parseQuantidade(req.body.quantidade);
    if (quantidade === null) {
      return res.status(400).json({ 
        success: false,
        error: "Quantidade inválida: deve ser um número inteiro positivo"
      });
    }

    const livroData = {
      titulo: req.body.titulo,
      autor: req.body.autor,
      quantidade
    };

    const valida = livroSchema.safeParse(livroData);
    if (!valida.success) {
      return res.status(400).json({ 
        success: false,
        error: valida.error.errors.map(e => e.message).join(', ')
      });
    }

    // Verifica se o livro existe antes de atualizar
    const existeLivro = await prisma.livro.findUnique({ where: { id } });
    if (!existeLivro) {
      return res.status(404).json({ success: false, error: "Livro não encontrado" });
    }

    const livro = await prisma.livro.update({
      where: { id },
      data: valida.data
    });

    return res.status(200).json({ success: true, livro });
  } catch (error) {
    console.error("Erro ao atualizar livro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao atualizar livro",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
