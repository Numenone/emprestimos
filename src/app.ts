// src/app.ts
import express from 'express';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import alunosRouter from './routes/alunos';
import livrosRouter from './routes/livros';
import emprestimosRouter from './routes/emprestimos';
import { authenticateJWT } from './auth/jwt';
import fs from 'fs';

const prisma = new PrismaClient();
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração de arquivos estáticos
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Rotas públicas
app.use('/alunos', alunosRouter);

// Rotas protegidas
app.use('/livros', authenticateJWT, livrosRouter);
app.use('/emprestimos', authenticateJWT, emprestimosRouter);

// Rota de status
app.get('/status', (req, res) => {
  res.json({ 
    status: 'online',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Tratamento de erros
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Inicialização do servidor
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
});

// Tratamento de encerramento
process.on('SIGTERM', async () => {
  console.log('Recebido SIGTERM. Encerrando servidor...');
  await prisma.$disconnect();
  server.close(() => {
    console.log('Servidor encerrado');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('Recebido SIGINT. Encerrando servidor...');
  await prisma.$disconnect();
  server.close(() => {
    console.log('Servidor encerrado');
    process.exit(0);
  });
});