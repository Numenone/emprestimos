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
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './types/express';
import cookieParser from 'cookie-parser';
const prisma = new PrismaClient();
const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = parseInt(process.env.PORT || '3000', 10);



app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'",
        "http://localhost:3000", // Backend local
        "http://localhost:3001", // Frontend local
        "https://emprestimos-nlq1.onrender.com" // Backend em produção
      ],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"]
    }
  }
}));

app.use(cors({
  origin: 'http://localhost:3001',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.use(morgan('combined'));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 999,
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

app.use(apiLimiter);
app.use('/usuarios/login', authLimiter);
app.use('/alunos/login', authLimiter);


const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath, {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.use('/alunos', alunosRouter);
app.use('/usuarios', usuariosRouter);
app.use(authenticateJWT);
app.use('/livros', authenticateJWT, livrosRouter);
app.use('/emprestimos', authenticateJWT, emprestimosRouter);

app.get('/status', (_req, res) => {
  res.json({ 
    status: 'online',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    security: {
      cors: true,
      rateLimiting: true,
      jwtAuth: true
    }
  });
});

app.post('/backup', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user || req.aluno;
    if (!user || user.nivelAcesso < 3) {
      return res.status(403).json({ 
        error: 'Acesso negado. Permissão insuficiente para realizar backup.' 
      });
    }

    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFile = path.join(backupDir, `backup-${Date.now()}.json`);
    const backupData = {
      alunos: await prisma.aluno.findMany(),
      livros: await prisma.livro.findMany(),
      emprestimos: await prisma.emprestimo.findMany(),
      usuarios: await prisma.usuario.findMany(),
      logs: await prisma.log.findMany()
    };

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

    const logData: {
      acao: string;
      detalhes: string;
      usuarioId?: number;
      alunoId?: number;
    } = {
      acao: 'BACKUP_SISTEMA',
      detalhes: `Backup realizado por ${user.email}`
    };

    if ('nivelAcesso' in user) {
    logData.usuarioId = user.id;
    }
    await prisma.log.create({
    data: logData
    });

    res.json({ 
      success: true, 
      message: 'Backup realizado com sucesso',
      file: backupFile
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Erro ao realizar backup' });
  }
});

app.post('/restore', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user || req.aluno;
    if (!user || user.nivelAcesso < 3) {
      return res.status(403).json({ 
        error: 'Acesso negado. Permissão insuficiente para realizar restauração.' 
      });
    }

    const { backupFile } = req.body;
    if (!backupFile || !fs.existsSync(backupFile)) {
      return res.status(400).json({ error: 'Arquivo de backup inválido ou não encontrado' });
    }

    const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

    await prisma.$transaction([
      prisma.aluno.deleteMany(),
      prisma.livro.deleteMany(),
      prisma.emprestimo.deleteMany(),
      prisma.usuario.deleteMany(),
      prisma.log.deleteMany()
    ]);

    await prisma.aluno.createMany({ data: backupData.alunos });
    await prisma.livro.createMany({ data: backupData.livros });
    await prisma.emprestimo.createMany({ data: backupData.emprestimos });
    await prisma.usuario.createMany({ data: backupData.usuarios });
    await prisma.log.createMany({ data: backupData.logs });

    await prisma.log.create({
      data: {
        acao: 'RESTORE_SISTEMA',
        detalhes: `Restauração realizada por ${user.email} a partir do arquivo ${backupFile}`,
        usuarioId: user.id,
        alunoId: user.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Restauração realizada com sucesso',
      restored: {
        alunos: backupData.alunos.length,
        livros: backupData.livros.length,
        emprestimos: backupData.emprestimos.length,
        usuarios: backupData.usuarios.length,
        logs: backupData.logs.length
      }
    });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Erro ao realizar restauração' });
  }
});

app.use((err: Error, req: any, res: Response, _next: NextFunction) => {
  console.error(err.stack);

  prisma.log.create({
    data: {
      acao: 'ERRO_SERVIDOR',
      detalhes: `Erro no endpoint ${req.method} ${req.path}: ${err.message}`,
      usuarioId: req.user?.id,
      alunoId: req.aluno?.id
    }
  }).catch((logError: unknown) => console.error('Failed to log error:', logError));

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  res.status(500).json({ 
    error: 'Erro interno do servidor',
    requestId: req.id ?? null
  });
});

app.use((_req, res, next) => {
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Feature-Policy', "geolocation 'none'; microphone 'none'; camera 'none'");
  next();
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('Configurações de segurança ativadas:');
  console.log('- Helmet (CSP, HSTS, etc)');
  console.log('- Rate limiting');
  console.log('- CORS restrito');
  console.log('- Autenticação JWT obrigatória para rotas protegidas');
});

const shutdown = async () => {
  console.log('Encerrando servidor...');
  try {
    await prisma.$disconnect();
    server.close(() => {
      console.log('Servidor encerrado');
      process.exit(0);
    });
  } catch (error) {
    console.error('Erro durante o encerramento:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await shutdown();
});
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  await shutdown();
});