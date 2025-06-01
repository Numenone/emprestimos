import express from 'express';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import alunosRouter from './routes/alunos';
import livrosRouter from './routes/livros';
import emprestimosRouter from './routes/emprestimos';

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Rotas
app.use('/alunos', alunosRouter);
app.use('/livros', livrosRouter);
app.use('/emprestimos', emprestimosRouter);

// Middleware de erro global
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Erro global:', err);
  res.status(500).json({
    success: false,
    error: 'Erro interno do servidor',
    details: err.message
  });
});

// Inicia o servidor e captura a instância
const server = app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});

// Tratamento de erros do servidor (ex: porta em uso)
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} já está em uso.`);
    process.exit(1);
  } else {
    console.error('Erro no servidor:', err.message);
  }
});
