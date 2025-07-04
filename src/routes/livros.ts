// src/routes/livros.ts
import { PrismaClient } from '@prisma/client';
import { Router, Response } from 'express';
import { z } from 'zod';
import { 
  generateToken,
  authenticateJWT, 
  checkPermission,
  refreshToken
} from '../auth/jwt';
import { AuthenticatedRequest } from '../types/express';

const prisma = new PrismaClient();
const router = Router();


const livroSchema = z.object({
  titulo: z.string().min(3, "Título deve ter pelo menos 3 caracteres"),
  autor: z.string().min(3, "Autor deve ter pelo menos 3 caracteres"),
  quantidade: z.number().int().positive("Quantidade deve ser um número inteiro positivo")
});

// GET todos os livros (não deletados)
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const livros = await prisma.livro.findMany({
      where: { deleted: false },
      orderBy: { titulo: 'asc' }
    });
    
    // Registrar log de acesso
    await prisma.log.create({
      data: {
        acao: 'LISTAGEM_LIVROS',
        detalhes: `Listagem de livros acessada por ${req.user?.email || req.aluno?.email}`,
        usuarioId: req.user?.id,
        alunoId: req.aluno?.id
      }
    });

    res.json({ success: true, livros });
  } catch (error) {
    await prisma.log.create({
      data: {
        acao: 'ERRO_LISTAGEM_LIVROS',
        detalhes: `Erro ao listar livros: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
        usuarioId: req.user?.id,
        alunoId: req.aluno?.id
      }
    });
    res.status(500).json({ error: 'Erro ao buscar livros' });
  }
});

// POST criar livro (apenas admin)
router.post("/", checkPermission(2), async (req: AuthenticatedRequest, res: Response) => {
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

    // Registrar log de criação
    await prisma.log.create({
      data: {
        acao: 'CRIACAO_LIVRO',
        detalhes: `Livro criado: ${livro.titulo} (ID: ${livro.id})`,
        usuarioId: req.user?.id
      }
    });

    res.status(201).json({ success: true, livro });
  } catch (error) {
    await prisma.log.create({
      data: {
        acao: 'ERRO_CRIACAO_LIVRO',
        detalhes: `Erro ao criar livro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
        usuarioId: req.user?.id
      }
    });
    res.status(500).json({ error: 'Erro ao criar livro' });
  }
});

// DELETE livro (soft delete, apenas admin)
router.delete("/:id", checkPermission(3), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const livro = await prisma.livro.update({
      where: { id: Number(req.params.id) },
      data: { 
        deleted: true,
        deletedAt: new Date()
      }
    });

    // Registrar log de exclusão
    await prisma.log.create({
      data: {
        acao: 'EXCLUSAO_LIVRO',
        detalhes: `Livro marcado como excluído: ${livro.titulo} (ID: ${livro.id})`,
        usuarioId: req.user?.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Livro marcado como excluído com sucesso' 
    });
  } catch (error) {
    await prisma.log.create({
      data: {
        acao: 'ERRO_EXCLUSAO_LIVRO',
        detalhes: `Erro ao excluir livro ID ${req.params.id}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
        usuarioId: req.user?.id
      }
    });
    res.status(500).json({ error: 'Erro ao excluir livro' });
  }
});

// PUT atualizar livro completo
router.put("/:id", checkPermission(2), async (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "ID inválido" });
  }

  try {
    const quantidade = Number(req.body.quantidade);
    if (isNaN(quantidade) || quantidade <= 0) {
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

    const existeLivro = await prisma.livro.findUnique({ where: { id } });
    if (!existeLivro) {
      return res.status(404).json({ success: false, error: "Livro não encontrado" });
    }

    const livro = await prisma.livro.update({
      where: { id },
      data: valida.data
    });

    // Registrar log de atualização
    await prisma.log.create({
      data: {
        acao: 'ATUALIZACAO_LIVRO',
        detalhes: `Livro atualizado: ${livro.titulo} (ID: ${livro.id})`,
        usuarioId: req.user?.id
      }
    });

    return res.status(200).json({ success: true, livro });
  } catch (error) {
    await prisma.log.create({
      data: {
        acao: 'ERRO_ATUALIZACAO_LIVRO',
        detalhes: `Erro ao atualizar livro ID ${req.params.id}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
        usuarioId: req.user?.id
      }
    });
    
    return res.status(500).json({
      success: false,
      error: "Erro ao atualizar livro",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;