// src/auth/jwt.ts
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_forte_123!@#';

interface TokenPayload {
  id: number;
  nivel: number;
}

export const generateToken = (alunoId: number, nivelAcesso: number): string => {
  return jwt.sign({ id: alunoId, nivel: nivelAcesso }, JWT_SECRET, {
    expiresIn: '1h'
  });
};

export const refreshToken = (alunoId: number, nivelAcesso: number): string => {
  return jwt.sign({ id: alunoId, nivel: nivelAcesso }, JWT_SECRET, {
    expiresIn: '7d'
  });
};

export const authenticateJWT = async (req: Request & { aluno?: any }, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    const aluno = await prisma.aluno.findUnique({
      where: { id: decoded.id, deleted: false }
    });

    if (!aluno || aluno.bloqueado || aluno.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Acesso negado. Conta inativa ou bloqueada.' });
    }

    req.aluno = aluno;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};

export const checkPermission = (nivelRequerido: number) => {
  return (req: Request & { aluno?: any }, res: Response, next: NextFunction) => {
    if (!req.aluno || req.aluno.nivelAcesso < nivelRequerido) {
      return res.status(403).json({ 
        error: 'Acesso negado. Permissão insuficiente.',
        requiredLevel: nivelRequerido,
        currentLevel: req.aluno?.nivelAcesso
      });
    }
    next();
  };
};

export const decodeToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    return null;
  }
};