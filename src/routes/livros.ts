import { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';
import { z } from 'zod';

const prisma = new PrismaClient();
const router = Router();

interface LivroRequestBody {
  titulo: string;
  autor: string;
  quantidade: string | number;
}

const livroSchema = z.object({
  titulo: z.string().min(3, "Título deve ter pelo menos 3 caracteres"),
  autor: z.string().min(3, "Autor deve ter pelo menos 3 caracteres"),
  quantidade: z.number().int().positive("Quantidade deve ser um número inteiro positivo")
});

// Função para converter e validar a quantidade
function parseQuantidade(q: string | number): number | null {
  const n = typeof q === 'number' ? q : parseInt(q, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET todos os livros (ordenados por título)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const livros = await prisma.livro.findMany({
      orderBy: { titulo: 'asc' }
    });
    return res.status(200).json({ success: true, livros });
  } catch (error) {
    return res.status(500).json({ 
      success: false,
      error: "Erro ao buscar livros",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// POST criar livro
router.post("/", async (req: Request<{}, {}, LivroRequestBody>, res: Response) => {
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

    const livro = await prisma.livro.create({
      data: valida.data,
      select: {
        id: true,
        titulo: true,
        autor: true,
        quantidade: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return res.status(201).json({ success: true, livro });
  } catch (error) {
    console.error('Erro ao criar livro:', error);
    return res.status(500).json({
      success: false,
      error: "Erro ao criar livro no banco de dados",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// GET livro por ID
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "ID inválido" });
  }

  try {
    const livro = await prisma.livro.findUnique({
      where: { id }
    });

    if (!livro) {
      return res.status(404).json({ success: false, error: "Livro não encontrado" });
    }

    return res.status(200).json({ success: true, livro });
  } catch (error) {
    return res.status(500).json({ 
      success: false,
      error: "Erro ao buscar livro",
      details: error instanceof Error ? error.message : String(error)
    });
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
