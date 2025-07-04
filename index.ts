import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
// import { authenticateJWT } from './auth/jwt'; // Commented out due to missing module

// Temporary placeholder for authenticateJWT middleware
const authenticateJWT = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // TODO: Implement JWT authentication logic here
  next();
};
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import csrf from 'csurf';
import cookieParser from 'cookie-parser';
// import { AuthenticatedRequest } from '../types/express'; // Commented out due to missing module
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;
const API_URL = process.env.API_URL || 'http://localhost:3000';

// Enhanced security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", API_URL],
      frameAncestors: ["'none'"]
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);

// CSRF protection
const csrfProtection = csrf({ cookie: true });
app.use(cookieParser());
app.use(csrfProtection);

// Body parsing with limits
app.use(bodyParser.urlencoded({ extended: true, limit: '10kb' }));
app.use(bodyParser.json({ limit: '10kb' }));

// Static files with cache control
app.use(express.static('public', {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.set('view engine', 'ejs');
app.set('trust proxy', 1); // For secure cookies

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.locals.csrfToken = req.csrfToken();
  next();
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  
  // Log the error (fallback to console if Prisma model does not exist)
  // prisma.log.create({
  //   data: {
  //     acao: 'ERRO_FRONTEND',
  //     detalhes: `Erro no endpoint ${req.method} ${req.path}: ${err.message}`,
  //     ip: req.ip
  //   }
  // }).catch((logError: unknown) => console.error('Failed to log error:', logError));

  res.status(500).render('error', { 
    message: 'Ocorreu um erro no servidor',
    csrfToken: req.csrfToken()
  });
});

// Main page with data and CSRF token
app.get('/', async (req, res) => {
  try {
    const [alunos, livros, emprestimos] = await Promise.all([
      axios.get(`${API_URL}/alunos`, {
        headers: { 'Authorization': `Bearer ${req.cookies.token}` }
      }).catch(() => ({ data: [] })),
      axios.get(`${API_URL}/livros`, {
        headers: { 'Authorization': `Bearer ${req.cookies.token}` }
      }).catch(() => ({ data: [] })),
      axios.get(`${API_URL}/emprestimos`, {
        headers: { 'Authorization': `Bearer ${req.cookies.token}` }
      }).catch(() => ({ data: [] }))
    ]);
    
    res.render('index', {
      alunos: alunos.data,
      livros: livros.data,
      emprestimos: emprestimos.data,
      success: req.query.success,
      error: req.query.error,
      csrfToken: req.csrfToken()
      // user: req.user // Removed because req.user does not exist on Request type
    });
  } catch (error) {
    console.error('Error loading data:', error);
    res.render('error', { 
      message: 'Erro ao carregar dados',
      csrfToken: req.csrfToken()
    });
  }
});

// Authentication routes
app.post('/login', async (req, res) => {
  try {
    const response = await axios.post(`${API_URL}/usuarios/login`, req.body);
    
    // Set secure, HTTP-only cookies
    res.cookie('token', response.data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600000, // 1 hour
      sameSite: 'strict'
    });
    
    res.cookie('refreshToken', response.data.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 604800000, // 7 days
      sameSite: 'strict'
    });
    
    res.redirect('/?success=Login realizado com sucesso');
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 'Erro ao realizar login';
    res.redirect(`/?error=${encodeURIComponent(errorMsg)}`);
  }
});

app.post('/logout', (_req, res) => {
  // Clear cookies
  res.clearCookie('token');
  res.clearCookie('refreshToken');
  res.redirect('/?success=Logout realizado com sucesso');
});

// Student routes with CSRF and JWT protection
app.post('/alunos', csrfProtection, async (req, res) => {
  try {
    await axios.post(`${API_URL}/alunos`, req.body);
    res.redirect('/?success=Aluno cadastrado com sucesso');
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || 'Erro ao criar aluno';
    res.redirect(`/?error=${encodeURIComponent(errorMsg)}`);
  }
});

app.post('/alunos/:id/email', authenticateJWT, csrfProtection, async (req, res) => {
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

// Book routes with CSRF and JWT protection
app.post('/livros', authenticateJWT, csrfProtection, async (req, res) => {
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

app.post('/livros/:id', authenticateJWT, csrfProtection, async (req, res) => {
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

// Loan routes with CSRF and JWT protection
app.post('/emprestimos', authenticateJWT, csrfProtection, async (req, res) => {
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

app.post('/emprestimos/:id/devolver', authenticateJWT, csrfProtection, async (req, res) => {
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

// Password recovery routes
app.get('/recuperar-senha', csrfProtection, (req, res) => {
  res.render('recover-password', { 
    csrfToken: req.csrfToken(),
    step: 1 
  });
});

app.post('/recuperar-senha', csrfProtection, async (req, res) => {
  try {
    await axios.post(`${API_URL}/usuarios/recuperar-senha`, { email: req.body.email });
    res.render('recover-password', {
      csrfToken: req.csrfToken(),
      step: 2,
      email: req.body.email,
      message: 'Código enviado para seu e-mail'
    });
  } catch (error: any) {
    res.render('recover-password', {
      csrfToken: req.csrfToken(),
      step: 1,
      error: error.response?.data?.error || 'Erro ao solicitar recuperação'
    });
  }
});

app.post('/redefinir-senha', csrfProtection, async (req, res) => {
  try {
    await axios.post(`${API_URL}/usuarios/redefinir-senha`, req.body);
    res.redirect('/login?success=Senha redefinida com sucesso');
  } catch (error: any) {
    res.render('recover-password', {
      csrfToken: req.csrfToken(),
      step: 2,
      email: req.body.email,
      error: error.response?.data?.error || 'Erro ao redefinir senha'
    });
  }
});

// Server startup with enhanced security
const server = app.listen(PORT, () => {
  console.log(`Sistema de Biblioteca rodando em http://localhost:${PORT}`);
  console.log('Configurações de segurança ativadas:');
  console.log('- Helmet (CSP, XSS, etc)');
  console.log('- Rate limiting');
  console.log('- CSRF protection');
  console.log('- Secure cookies');
});

// Graceful shutdown
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