// src/types/express.d.ts
import { Aluno, Usuario } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      aluno?: Aluno;
      user?: Usuario;
    }
  }
}

export interface AuthenticatedRequest extends Express.Request {
  aluno?: Aluno;
  user?: Usuario;
  body: any;
  params: any;
  query: any;
}