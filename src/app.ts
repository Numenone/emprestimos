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
import { Request, Response, NextFunction } from 'express';

const prisma = new PrismaClient();
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Enhanced security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "trusted-cdn.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", process.env.FRONTEND_URL || 'http://localhost:3001'],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  },
  hsts: {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'same-origin' }
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400
}));

// Request logging
app.use(morgan('combined'));

// Rate limiting - more strict for auth endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

app.use(apiLimiter);
app.use('/usuarios/login', authLimiter);
app.use('/alunos/login', authLimiter);

// Body parsing with size limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Static files with cache control
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath, {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Public routes
app.use('/alunos', alunosRouter);
app.use('/usuarios', usuariosRouter);

// Protected routes with JWT authentication
app.use('/livros', authenticateJWT, livrosRouter);
app.use('/emprestimos', authenticateJWT, emprestimosRouter);

// Status route
app.get('/status', (req, res) => {
  res.json({ 
    status: 'online',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    security: {
      cors: true,
      helmet: true,
      rateLimiting: true,
      jwtAuth: true
    }
  });
});

// Backup route with admin permission check
app.post('/backup', authenticateJWT, async (req, res) => {
  try {
    // Check if user has admin privileges
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
      alunos: await prisma.aluno.findMany({ where: { deleted: false } }),
      livros: await prisma.livro.findMany({ where: { deleted: false } }),
      emprestimos: await prisma.emprestimo.findMany({ where: { deleted: false } }),
      usuarios: await prisma.usuario.findMany({ where: { deleted: false } }),
      logs: await prisma.log.findMany()
    };

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

    // Log the backup action
    await prisma.log.create({
      data: {
        acao: 'BACKUP_SISTEMA',
        detalhes: `Backup realizado por ${user.email}`,
        usuarioId: user.id,
        alunoId: user.id
      }
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

// Restore route with admin permission check
app.post('/restore', authenticateJWT, async (req, res) => {
  try {
    // Check if user has admin privileges
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

    // Start transaction for data restoration
    await prisma.$transaction([
      prisma.aluno.deleteMany(),
      prisma.livro.deleteMany(),
      prisma.emprestimo.deleteMany(),
      prisma.usuario.deleteMany(),
      prisma.log.deleteMany()
    ]);

    // Restore data
    await prisma.aluno.createMany({ data: backupData.alunos });
    await prisma.livro.createMany({ data: backupData.livros });
    await prisma.emprestimo.createMany({ data: backupData.emprestimos });
    await prisma.usuario.createMany({ data: backupData.usuarios });
    await prisma.log.createMany({ data: backupData.logs });

    // Log the restore action
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

// Enhanced error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  
  // Log the error
  prisma.log.create({
    data: {
      acao: 'ERRO_SERVIDOR',
      detalhes: `Erro no endpoint ${req.method} ${req.path}: ${err.message}`,
      usuarioId: req.user?.id,
      alunoId: req.aluno?.id
    }
  }).catch(logError => console.error('Failed to log error:', logError));

  // Security headers for error responses
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    requestId: req.id
  });
});

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Feature-Policy', "geolocation 'none'; microphone 'none'; camera 'none'");
  next();
});

// Server startup with enhanced security
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('Configurações de segurança ativadas:');
  console.log('- Helmet (CSP, HSTS, etc)');
  console.log('- Rate limiting');
  console.log('- CORS restrito');
  console.log('- Autenticação JWT obrigatória para rotas protegidas');
});

// Graceful shutdown with cleanup
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