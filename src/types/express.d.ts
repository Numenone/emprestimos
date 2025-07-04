import { Usuario, Aluno } from '@prisma/client';
import { Request, Response } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: Usuario;
      aluno?: Aluno;
      cookies: {
        token?: string;
        refreshToken?: string;
      };
      ip?: string;
      id: number;
      nivelAcesso: number;
      } 
    

    interface Response {
      locals: {
        user?: Usuario;
      };
      render: (view: string, options?: object) => void;
      redirect: (url: string) => void;
      cookie: (name: string, value: string, options?: object) => void;
      clearCookie: (name: string) => void;
      setHeader: (name: string, value: string) => void;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user?: Usuario;
  aluno?: Aluno;
}