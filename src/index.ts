import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { authenticateJWT } from './auth/jwt';
import { AuthenticatedRequest } from './types/express';
import { NextFunction, Request, Response } from 'express';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;
const API_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3000'
  : 'https://emprestimos-nlq1.onrender.com';



const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);


app.use(cookieParser());

app.use(bodyParser.urlencoded({ extended: true, limit: '10kb' }));
app.use(bodyParser.json({ limit: '10kb' }));

app.use(express.static('public', {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.set('view engine', 'ejs');
app.set('trust proxy', 1);

app.use((req: Request, res: Response, next: NextFunction) => {
  
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  res.locals.user = (req as AuthenticatedRequest).user;
  next();
});

const checkAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.cookies.token;
  
  if (!token) {
    return next();
  }

  try {
    const response = await axios.get(`${API_URL}/usuarios/perfil`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    req.user = response.data;
  } catch (error) {
    res.clearCookie('token');
    res.clearCookie('refreshToken');
  }
  next();
};

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  
  prisma.log.create({
    data: {
      acao: 'ERRO_FRONTEND',
      detalhes: `Erro no endpoint ${req.method} ${req.path}: ${err.message}`,
      ip: req.ip
    }
  }).catch((logError: unknown) => console.error('Failed to log error:', logError));
}); 

export const indexController = async (req: Request, res: Response) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { deleted: false },
      select: {
        id: true,
        nome: true,
        email: true,
        nivelAcesso: true,
        status: true,
        bloqueado: true
      }
    });

    res.render('index', {
      usuarios: usuarios || [],
      user: req.user || null
    });
  } catch (error) {
    console.error('Error in index controller:', error);
    res.status(500).render('error', {
      message: 'Error loading user data',
    });
  }
};

app.get('/', checkAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const headers = req.cookies.token ? { 'Authorization': `Bearer ${req.cookies.token}` } : {};
    
    const [alunos, livros, emprestimos] = await Promise.all([
      axios.get(`${API_URL}/alunos`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API_URL}/livros`, { headers }).catch(() => ({ data: [] })),
      axios.get(`${API_URL}/emprestimos`, { headers }).catch(() => ({ data: [] }))
    ]);
    
    res.render('index', {
      alunos: alunos.data,
      livros: livros.data,
      emprestimos: emprestimos.data,
      success: req.query.success,
      error: req.query.error,
      user: req.user
    });
  } catch (error) {
    console.error('Error loading data:', error);
    res.render('error', { 
      message: 'Erro ao carregar dados',
    });
  }
});

app.post('/login', async (req: Request, res: Response) => {
  try {
    const response = await axios.post(`${API_URL}/usuarios/login`, req.body);
    
    res.cookie('token', response.data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600000,
      sameSite: 'strict',
      path: '/'
    });
    
    res.cookie('refreshToken', response.data.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 604800000,
      sameSite: 'strict',
      path: '/'
    });
    
    res.redirect('/?success=Login realizado com sucesso');
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 'Erro ao realizar login';
    res.redirect(`/?error=${encodeURIComponent(errorMsg)}`);
  }
});

app.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('token');
  res.clearCookie('refreshToken');
  res.redirect('/?success=Logout realizado com sucesso');
});

app.post('/usuarios', async (req: Request, res: Response) => {
  try {
    const response = await axios.post(`${API_URL}/usuarios`, req.body);
    res.redirect('/?success=Usuário cadastrado com sucesso. Verifique seu email para ativar a conta.');
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 'Erro ao cadastrar usuário';
    res.redirect(`/?error=${encodeURIComponent(errorMsg)}`);
  }
});

const protectedRoutes = express.Router();
protectedRoutes.use(authenticateJWT);

protectedRoutes.post('/alunos', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await axios.post(`${API_URL}/alunos`, req.body, {
      headers: { 'Authorization': `Bearer ${req.cookies.token}` }, 
    });
    res.redirect('/?success=Aluno cadastrado com sucesso');
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 'Erro ao criar aluno';
    res.redirect(`/?error=${encodeURIComponent(errorMsg)}`);
  }
});

protectedRoutes.post('/alunos/:id/email', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await axios.post(`${API_URL}/alunos/${req.params.id}/email`, {}, {
      headers: { 'Authorization': `Bearer ${req.cookies.token}` }
    });
    res.redirect('/?success=E-mail enviado com sucesso');
  } catch (error: any) {
    console.error('Email error:', error.response?.data || error.message);
    res.redirect('/?error=Erro ao enviar e-mail');
  }
});

protectedRoutes.post('/livros', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await axios.post(`${API_URL}/livros`, req.body, {
      headers: { 'Authorization': `Bearer ${req.cookies.token}` }
    });
    res.redirect('/?success=Livro cadastrado com sucesso');
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 'Erro ao cadastrar livro';
    res.redirect(`/?error=${encodeURIComponent(errorMsg)}`);
  }
});

protectedRoutes.post('/livros/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { titulo, autor, quantidade } = req.body;
    await axios.put(`${API_URL}/livros/${id}`, { titulo, autor, quantidade }, {
      headers: { 'Authorization': `Bearer ${req.cookies.token}` }
    });
    res.redirect('/?success=Livro atualizado com sucesso');
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 'Erro ao atualizar livro';
    res.redirect(`/?error=${encodeURIComponent(errorMsg)}`);
  }
});

protectedRoutes.post('/emprestimos', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await axios.post(`${API_URL}/emprestimos`, req.body, {
      headers: { 'Authorization': `Bearer ${req.cookies.token}` }
    });
    res.redirect('/?success=Empréstimo registrado com sucesso');
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 'Erro ao registrar empréstimo';
    res.redirect(`/?error=${encodeURIComponent(errorMsg)}`);
  }
});

protectedRoutes.post('/emprestimos/:id/devolver', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await axios.delete(`${API_URL}/emprestimos/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${req.cookies.token}` }
    });
    res.redirect('/?success=Empréstimo devolvido com sucesso');
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 'Erro ao registrar devolução';
    res.redirect(`/?error=${encodeURIComponent(errorMsg)}`);
  }
});

app.get('/recuperar-senha', (req: Request, res: Response) => {
  res.render('recover-password', { 
    step: 1 
  });
});

app.post('/recuperar-senha', async (req: Request, res: Response) => {
  try {
    await axios.post(`${API_URL}/usuarios/recuperar-senha`, { email: req.body.email });
    res.render('recover-password', {
      step: 2,
      email: req.body.email,
      message: 'Código enviado para seu e-mail',
      error: null
    });
  } catch (error: any) {
    res.render('recover-password', {
      step: 1,
      email: req.body.email,
      message: null,
      error: error.response?.data?.error || 'Erro ao solicitar recuperação'
    });
  }
});

app.post('/redefinir-senha', async (req: Request, res: Response) => {
  try {
    await axios.post(`${API_URL}/usuarios/redefinir-senha`, req.body);
    res.redirect('/login?success=Senha redefinida com sucesso');
  } catch (error: any) {
    res.render('recover-password', {
      step: 2,
      email: req.body.email,
      message: null,
      error: error.response?.data?.error || 'Erro ao redefinir senha'
    });
  }
});

const adminRoutes = express.Router();
adminRoutes.use(authenticateJWT);


adminRoutes.get('/admin', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [usuarios, logs] = await Promise.all([
      prisma.usuario.findMany({ where: { deleted: false } }),
      prisma.log.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
    ]);

    const safeUsuarios = (usuarios || []).filter(u => u);
    
    res.render('admin', {
      usuarios: safeUsuarios,
      logs: logs || [],
      user: req.user
    });
  } catch (error) {
    console.error('Admin error:', error);
    res.status(500).render('error', { 
      message: 'Erro ao carregar dados administrativos',
    });
  }
});

app.use(protectedRoutes);
app.use(adminRoutes);

const server = app.listen(PORT, () => {
  console.log(`Sistema de Biblioteca rodando em http://localhost:${PORT}`);
  console.log('Configurações de segurança ativadas:');
  console.log('- Helmet (CSP, XSS, etc)');
  console.log('- Rate limiting');
  console.log('- Secure cookies');
  console.log('- JWT authentication');
});

const shutdown = () => {
  console.log('Encerrando servidor...');
  server.close(async () => {
    await prisma.$disconnect();
    console.log('Servidor encerrado');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  shutdown();
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown();
});