import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';

const app = express();
const PORT = 3001; // Diferente da porta da API
const API_URL = 'http://localhost:3000'; // URL da sua API

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Página principal
app.get('/', async (req, res) => {
  try {
    const [alunos, livros, emprestimos] = await Promise.all([
      axios.get(`${API_URL}/alunos`),
      axios.get(`${API_URL}/livros`),
      axios.get(`${API_URL}/emprestimos`)
    ]);
    
    res.render('index', {
      alunos: alunos.data,
      livros: livros.data,
      emprestimos: emprestimos.data
    });
  } catch (error) {
    res.render('error', { message: 'Erro ao carregar dados' });
  }
});

// Rotas para Alunos
app.post('/alunos', async (req, res) => {
  try {
    await axios.post(`${API_URL}/alunos`, req.body);
    res.redirect('/');
  } catch (error) {
    res.render('error', { message: 'Erro ao criar aluno' });
  }
});

app.post('/alunos/:id/email', async (req, res) => {
  try {
    await axios.post(`${API_URL}/alunos/${req.params.id}/email`);
    res.redirect('/');
  } catch (error) {
    res.render('error', { message: 'Erro ao enviar e-mail' });
  }
});

// Rotas para Livros
app.post('/livros', async (req, res) => {
  try {
    const response = await axios.post(`${API_URL}/livros`, req.body);
    
    if (response.data.success) {
      // Atualiza a lista de livros após cadastro bem-sucedido
      const livros = await axios.get(`${API_URL}/livros`);
      res.render('index', {
        livros: livros.data,
        alunos: res.locals.alunos,
        emprestimos: res.locals.emprestimos
      });
    } else {
      res.render('error', { 
        message: 'Erro ao cadastrar livro: ' + response.data.error 
      });
    }
  } catch (error) {
    console.error('Erro ao cadastrar livro:', error);
    res.render('error', { 
      message: 'Erro ao cadastrar livro' 
    });
  }
});

// Rotas para Empréstimos
app.post('/emprestimos', async (req, res) => {
  try {
    await axios.post(`${API_URL}/emprestimos`, req.body);
    res.redirect('/');
  } catch (error) {
    res.render('error', { message: 'Erro ao registrar empréstimo' });
  }
});

app.post('/emprestimos/:id/devolver', async (req, res) => {
  try {
    await axios.delete(`${API_URL}/emprestimos/${req.params.id}`);
    res.redirect('/');
  } catch (error) {
    res.render('error', { message: 'Erro ao registrar devolução' });
  }
});

app.listen(PORT, () => {
  console.log(`Sistema de Biblioteca rodando em http://localhost:${PORT}`);
});