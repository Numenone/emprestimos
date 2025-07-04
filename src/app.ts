// src/app.ts
import express from 'express';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import alunosRouter from './routes/alunos';
import livrosRouter from './routes/livros';
import emprestimosRouter from './routes/emprestimos';
import usuariosRouter from './routes/usuarios';
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
app.use('/usuarios', usuariosRouter);

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

// Backup route
app.post('/backup', authenticateJWT, async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFile = path.join(backupDir, `backup-${Date.now()}.json`);
    const backupData = {
      alunos: await prisma.aluno.findMany({ where: { deleted: false } }),
      livros: await prisma.livro.findMany({ where: { deleted: false } }),
      emprestimos: await prisma.emprestimo.findMany({ where: { deleted: false } }),
      usuarios: await prisma.usuario.findMany({ where: { deleted: false } }),
      logs: await prisma.log.findMany()
    };

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

    res.json({ 
      success: true, 
      message: 'Backup realizado com sucesso',
      file: backupFile
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao realizar backup' });
  }
});

// Restore route
app.post('/restore', authenticateJWT, async (req, res) => {
  try {
    const { backupFile } = req.body;
    
    if (!backupFile || !fs.existsSync(backupFile)) {
      return res.status(400).json({ error: 'Arquivo de backup inválido' });
    }

    const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));

    // Clear existing data (optional - you might want to merge instead)
    await prisma.log.deleteMany();
    await prisma.emprestimo.deleteMany();
    await prisma.aluno.deleteMany();
    await prisma.livro.deleteMany();
    await prisma.usuario.deleteMany();

    // Restore data
    await prisma.aluno.createMany({ data: backupData.alunos });
    await prisma.livro.createMany({ data: backupData.livros });
    await prisma.emprestimo.createMany({ data: backupData.emprestimos });
    await prisma.usuario.createMany({ data: backupData.usuarios });
    await prisma.log.createMany({ data: backupData.logs });

    res.json({ 
      success: true, 
      message: 'Restauração realizada com sucesso',
      restoredItems: {
        alunos: backupData.alunos.length,
        livros: backupData.livros.length,
        emprestimos: backupData.emprestimos.length,
        usuarios: backupData.usuarios.length,
        logs: backupData.logs.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao restaurar backup' });
  }
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