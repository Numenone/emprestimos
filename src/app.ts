import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import cors from 'cors';
import path from 'path';

const app = express();
const PORT = 3001;
const API_URL = 'http://localhost:3000';

// Middlewares
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Servir arquivos estáticos (somente uma vez)
app.use(express.static(path.join(__dirname, '../public')));

// Configuração do EJS
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

// Tipagem para render
interface RenderOptions {
  alunos: any[];
  livros: any[];
  emprestimos: any[];
  success?: string | null;
  error?: string | null;
}

// Função para tratamento genérico de erros do axios
const handleError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (data) {
      if (typeof data === 'string') return data;
      if ('error' in data) return (data as any).error;
      if ('message' in data) return (data as any).message;
      return JSON.stringify(data);
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Erro desconhecido';
};

// Rota principal que busca dados da API e renderiza
app.get('/', async (req: Request, res: Response) => {
  // Headers para evitar cache
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const [alunosRes, livrosRes, emprestimosRes] = await Promise.all([
      axios.get(`${API_URL}/alunos`).catch(() => ({ data: [] })),
      axios.get(`${API_URL}/livros`).catch(() => ({ data: [] })),
      axios.get(`${API_URL}/emprestimos`).catch(() => ({ data: [] }))
    ]);

    const renderOptions: RenderOptions = {
      alunos: alunosRes.data,
      livros: livrosRes.data,
      emprestimos: emprestimosRes.data,
      success: req.query.success ? String(req.query.success) : null,
      error: req.query.error ? String(req.query.error) : null
    };

    res.render('index', renderOptions);
  } catch (error) {
    console.error('Erro ao carregar dados:', error);
    res.render('error', { 
      message: 'Erro ao carregar dados',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Rota para criar aluno
app.post('/alunos', async (req: Request, res: Response) => {
  try {
    const alunoData = {
      nome: req.body.nome,
      email: req.body.email,
      matricula: req.body.matricula
    };
    // console.log('Dados recebidos:', alunoData);

    await axios.post(`${API_URL}/alunos`, alunoData);
    res.redirect('/?success=Aluno cadastrado com sucesso');
  } catch (error) {
    console.error('Erro ao cadastrar aluno:', error);
    const message = handleError(error);
    res.redirect(`/?error=${encodeURIComponent(message)}`);
  }
});

// Rota para enviar e-mail do aluno
app.post('/alunos/:id/email', async (req: Request, res: Response) => {
  try {
    await axios.post(`${API_URL}/alunos/${req.params.id}/email`);
    res.redirect('/?success=E-mail enviado com sucesso');
  } catch (error) {
    const message = handleError(error);
    res.redirect(`/?error=${encodeURIComponent(message)}`);
  }
});

// Rota para criar livro
app.post('/livros', async (req: Request, res: Response) => {
  try {
    const quantidade = parseInt(req.body.quantidade, 10);
    if (isNaN(quantidade) || quantidade <= 0) {
      return res.redirect(`/?error=${encodeURIComponent('Quantidade inválida')}`);
    }

    const livroData = {
      titulo: req.body.titulo,
      autor: req.body.autor,
      quantidade
    };

    const response = await axios.post(`${API_URL}/livros`, livroData);

    if (response.data.success && response.data.livro) {
      res.redirect('/?success=Livro cadastrado com sucesso');
    } else {
      res.redirect(`/?error=${encodeURIComponent(response.data.error || 'Erro desconhecido')}`);
    }
  } catch (error) {
    const message = handleError(error);
    res.redirect(`/?error=${encodeURIComponent(message)}`);
  }
});

// Rota para criar empréstimo
app.post('/emprestimos', async (req: Request, res: Response) => {
  try {
    const emprestimoData = {
      alunoId: Number(req.body.alunoId),
      livroId: Number(req.body.livroId),
      dataDevolucao: req.body.dataDevolucao
    };

    if (
      isNaN(emprestimoData.alunoId) || 
      isNaN(emprestimoData.livroId) ||
      !emprestimoData.dataDevolucao
    ) {
      return res.redirect(`/?error=${encodeURIComponent('Dados inválidos para empréstimo')}`);
    }

    await axios.post(`${API_URL}/emprestimos`, emprestimoData);
    res.redirect('/?success=Empréstimo registrado com sucesso');
  } catch (error) {
    console.error('Erro no servidor:', error);
    const message = handleError(error);
    res.redirect(`/?error=${encodeURIComponent(message)}`);
  }
});

// Rota para registrar devolução
app.post('/emprestimos/:id/devolver', async (req: Request, res: Response) => {
  try {
    await axios.delete(`${API_URL}/emprestimos/${req.params.id}`);
    res.redirect('/?success=Devolução registrada com sucesso');
  } catch (error) {
    const message = handleError(error);
    res.redirect(`/?error=${encodeURIComponent(message)}`);
  }
});

// Rota para atualizar livro
app.put('/livros/:id', async (req: Request, res: Response) => {
  try {
    await axios.put(`${API_URL}/livros/${req.params.id}`, req.body);
    res.redirect('/?success=Livro atualizado com sucesso');
  } catch (error) {
    const message = handleError(error);
    res.redirect(`/?error=${encodeURIComponent(message)}`);
  }
});

// Middleware para tratamento global de erros
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Erro no middleware:', err);
  res.status(500).json({
    success: false,
    error: 'Erro interno do servidor',
    details: err.message
  });
});

// Inicia servidor
app.listen(PORT, () => {
  console.log(`Sistema de Biblioteca rodando em http://localhost:${PORT}`);
}).on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} já está em uso.`);
    process.exit(1);
  }
});
