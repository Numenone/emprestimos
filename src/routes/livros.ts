import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

const prisma = new PrismaClient();
const router = Router();

const livroSchema = z.object({
  titulo: z.string().min(3),
  autor: z.string().min(3),
  quantidade: z.number().int().positive()
});

router.get("/", async (req, res) => {
  try {
    const livros = await prisma.livro.findMany();
    res.json(livros);
  } catch (error) {
    res.status(500).json({ error });
  }
});

router.post("/", async (req, res) => {
  const valida = livroSchema.safeParse(req.body);
  if (!valida.success) {
    return res.status(400).json({ error: valida.error });
  }

  try {
    const livro = await prisma.livro.create({ data: valida.data });
    res.status(201).json(livro);
  } catch (error) {
    res.status(400).json({ error });
  }
});

export default router;