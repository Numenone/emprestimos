import { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express'; // Importe os tipos corretos
import { z } from 'zod';

const prisma = new PrismaClient();
const router = Router();

// Defina a interface para o corpo da requisição
interface LivroRequestBody {
  titulo: string;
  autor: string;
  quantidade: string | number;
}

const livroSchema = z.object({
  titulo: z.string().min(3, "Título deve ter pelo menos 3 caracteres"),
  autor: z.string().min(3, "Autor deve ter pelo menos 3 caracteres"),
  quantidade: z.number().int().positive("Quantidade deve ser um número positivo")
});

// GET todos os livros
router.get("/", async (req: Request, res: Response) => {
  try {
    const livros = await prisma.livro.findMany({
      orderBy: {
        titulo: 'asc'
      }
    });
    res.status(200).json(livros);
  } catch (error) {
    res.status(500).json({ 
      error: "Erro ao buscar livros",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// POST criar livro
router.post("/", async (req: Request<{}, {}, LivroRequestBody>, res: Response) => {
  try {
    const livroData = {
      titulo: req.body.titulo,
      autor: req.body.autor,
      quantidade: parseInt(req.body.quantidade.toString())
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
        createdAt: true,  // Usando o nome do campo conforme definido no Prisma
        updatedAt: true   // Usando o nome do campo conforme definido no Prisma
      }
    });

    res.status(201).json({
      success: true,
      livro
    });
  } catch (error) {
    console.error('Erro ao criar livro:', error);
    res.status(500).json({
      success: false,
      error: "Erro ao criar livro no banco de dados",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// GET livro por ID
router.get("/:id", async (req: Request<{id: string}>, res: Response) => {
  try {
    const livro = await prisma.livro.findUnique({
      where: { id: Number(req.params.id) }
    });

    if (!livro) {
      return res.status(404).json({ error: "Livro não encontrado" });
    }

    res.status(200).json(livro);
  } catch (error) {
    res.status(500).json({ 
      error: "Erro ao buscar livro",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// PUT atualizar livro completo
router.put("/:id", async (req: Request<{id: string}, {}, LivroRequestBody>, res: Response) => {
  try {
    const livroData = {
      titulo: req.body.titulo,
      autor: req.body.autor,
      quantidade: parseInt(req.body.quantidade.toString())
    };

    const valida = livroSchema.safeParse(livroData);
    
    if (!valida.success) {
      return res.status(400).json({ 
        success: false,
        error: valida.error.errors.map(e => e.message).join(', ')
      });
    }

    const livro = await prisma.livro.update({
      where: { id: Number(req.params.id) },
      data: valida.data
    });
    
    res.status(200).json({
      success: true,
      livro
    });
  } catch (error) {
    console.error("Erro ao atualizar livro:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao atualizar livro",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;