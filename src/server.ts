import express from 'express';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import alunosRouter from './routes/alunos';
import livrosRouter from './routes/livros';
import emprestimosRouter from './routes/emprestimos';

const app = express();
const PORT = 3000;

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

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
});

// Tratamento de erros do servidor
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} já está em uso.`);
    process.exit(1);
  }
  console.error('Erro no servidor:', err.message);
});