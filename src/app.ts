import express from 'express';
import cors from 'cors';
import path from 'path';
import livrosRouter from './routes/livros';
import emprestimosRouter from './routes/emprestimos';
import { PrismaClient } from '@prisma/client';
import methodOverride from 'method-override';
import alunosRouter from './routes/alunos';



const prisma = new PrismaClient();
const app = express();
const PORT: number = parseInt(process.env.PORT || '10000', 10);

// Middlewares
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));
app.use(methodOverride('_method'));

// Verifique se o caminho está correto
console.log(`Serving static files from: ${publicPath}`);

const viewsPath = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, 'views')
  : path.join(__dirname, '../src/views');

app.set('view engine', 'ejs');
app.set('views', viewsPath);

// Rotas da API
app.use('/alunos', alunosRouter);
app.use('/livros', livrosRouter);
app.use('/emprestimos', emprestimosRouter);



// Rota principal que renderiza a página
app.get('/', async (req, res) => {
  try {
    const [alunos, livros, emprestimos] = await Promise.all([
      prisma.aluno.findMany(),
      prisma.livro.findMany(),
      prisma.emprestimo.findMany({
        where: { devolvido: false },
        include: {
          aluno: true,
          livro: true
        }
      })
    ]);

    res.render('index', {
      alunos,
      livros,
      emprestimos,
      success: req.query.success,
      error: req.query.error
    });
  } catch (error) {
    console.error('Erro ao carregar dados:', error);
    res.render('error', { message: 'Erro ao carregar dados' });
  }
});

// Rotas do frontend (para formulários)
app.post('/alunos', async (req, res) => {
  try {
    await prisma.aluno.create({ data: req.body });
    res.redirect('/?success=Aluno cadastrado com sucesso');
  } catch (error) {
    res.redirect('/?error=Erro ao criar aluno');
  }
});

app.post('/livros', async (req, res) => {
  try {
    await prisma.livro.create({ 
      data: {
        ...req.body,
        quantidade: parseInt(req.body.quantidade)
      }
    });
    res.redirect('/?success=Livro cadastrado com sucesso');
  } catch (error) {
    res.redirect('/?error=Erro ao cadastrar livro');
  }
});

app.post('/emprestimos', async (req, res) => {
  try {
    await prisma.emprestimo.create({
      data: {
        alunoId: parseInt(req.body.alunoId),
        livroId: parseInt(req.body.livroId),
        dataEmprestimo: new Date(),
        dataDevolucao: new Date(req.body.dataDevolucao),
        devolvido: false
      }
    });
    res.redirect('/?success=Empréstimo registrado com sucesso');
  } catch (error) {
    res.redirect('/?error=Erro ao registrar empréstimo');
  }
});

app.post('/emprestimos/:id/devolver', async (req, res) => {
  try {
    await prisma.emprestimo.update({
      where: { id: parseInt(req.params.id) },
      data: { devolvido: true, dataDevolucao: new Date() }
    });
    res.redirect('/?success=Empréstimo devolvido com sucesso');
  } catch (error) {
    res.redirect('/?error=Erro ao registrar devolução');
  }
});

app.put('/livros/:id', async (req, res) => {
  try {
    await prisma.livro.update({
      where: { id: parseInt(req.params.id) },
      data: {
        titulo: req.body.titulo,
        autor: req.body.autor,
        quantidade: parseInt(req.body.quantidade)
      }
    });
    res.redirect('/?success=Livro atualizado com sucesso');
  } catch (error) {
    res.redirect('/?error=Erro ao atualizar livro');
  }
});

// Inicia servidor
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});


app.listen(PORT, '0.0.0.0', () => { // Adicione '0.0.0.0'
  console.log(`Servidor rodando na porta ${PORT}`);
});