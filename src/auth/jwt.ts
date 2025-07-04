import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { Usuario } from '@prisma/client';

// Ensure JWT_SECRET is defined
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not defined in environment variables');
}

interface CustomJwtPayload extends JwtPayload {
  id: number;
  nivelAcesso: number;
}

export const authenticateJWT = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as CustomJwtPayload;
    req.user = {
      id: decoded.id,
      nivelAcesso: decoded.nivelAcesso
    } as Usuario;
    next();
  } catch (error) {
    console.error('JWT Verification Error:', error);
    return res.status(403).json({ error: 'Token inválido ou expirado' });
  }
};

export const generateToken = (userId: number, nivelAcesso: number): string => {
  const payload = { id: userId, nivelAcesso };
  const options: SignOptions = { expiresIn: process.env.TOKEN_EXPIRY || '1h' };
  
  return jwt.sign(payload, JWT_SECRET, options);
};

export const refreshToken = (userId: number, nivelAcesso: number): string => {
  const payload = { id: userId, nivelAcesso };
  const options: SignOptions = { expiresIn: process.env.REFRESH_EXPIRY || '7d' };
  
  return jwt.sign(payload, JWT_SECRET, options);
};

export const checkPermission = (nivelRequerido: number) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || req.user.nivelAcesso < nivelRequerido) {
      return res.status(403).render('error', {
        message: 'Acesso negado. Permissão insuficiente.',
      });
    }
    next();
  };
};