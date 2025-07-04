import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_please_change_in_production';

interface TokenPayload {
  id: number;
  nivel: number;
  iat: number;
  exp: number;
}

export const generateToken = (userId: number, nivelAcesso: number): string => {
  return jwt.sign({ id: userId, nivel: nivelAcesso }, JWT_SECRET, {
    expiresIn: '1h'
  });
};

export const refreshToken = (userId: number, nivelAcesso: number): string => {
  return jwt.sign({ id: userId, nivel: nivelAcesso }, JWT_SECRET, {
    expiresIn: '7d'
  });
};

interface AuthenticatedRequest extends Request {
  aluno?: any;
  user?: any;
}

export const authenticateJWT = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    
    // Check if token is expired
    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      return res.status(401).json({ error: 'Token expirado' });
    }

    // First try to verify as student
    const aluno = await prisma.aluno.findUnique({
      where: { 
        id: decoded.id,
        deleted: false 
      }
    });

    if (aluno) {
      if (aluno.bloqueado || aluno.status !== 'ATIVO') {
        return res.status(403).json({ error: 'Acesso negado. Conta inativa ou bloqueada.' });
      }
      req.aluno = aluno;
      return next();
    }

    // If not student, verify as user
    const usuario = await prisma.usuario.findUnique({
      where: { 
        id: decoded.id,
        deleted: false 
      }
    });

    if (usuario) {
      if (usuario.bloqueado || usuario.status !== 'ATIVO') {
        return res.status(403).json({ error: 'Acesso negado. Conta inativa ou bloqueada.' });
      }
      req.user = usuario;
      return next();
    }

    return res.status(403).json({ error: 'Usuário não encontrado' });
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(401).json({ error: 'Token inválido' });
  }
};

export const checkPermission = (nivelRequerido: number) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user || req.aluno;
    
    if (!user || user.nivelAcesso < nivelRequerido) {
      return res.status(403).json({ 
        error: 'Acesso negado. Permissão insuficiente.',
        requiredLevel: nivelRequerido,
        currentLevel: user?.nivelAcesso
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