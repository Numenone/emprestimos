import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';

const app = express();
const PORT = process.env.PORT || 3001; // Porta do frontend
const API_URL = process.env.API_URL || 'http://localhost:3000'; // URL da API backend

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
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
      emprestimos: emprestimos.data,
      success: req.query.success,
      error: req.query.error
    });
  } catch (error) {
    res.render('error', { message: 'Erro ao carregar dados' });
  }
});

// Rotas para Alunos
app.post('/alunos', async (req, res) => {
  try {
    await axios.post(`${API_URL}/alunos`, req.body);
    res.redirect('/?success=Aluno cadastrado com sucesso');
  } catch (error) {
    res.redirect('/?error=Erro ao criar aluno');
  }
});

app.post('/alunos/:id/email', async (req, res) => {
  try {
    await axios.post(`${API_URL}/api/alunos/${req.params.id}/email`);
    res.redirect('/?success=E-mail enviado com sucesso');
  } catch (error) {
    console.error('Erro ao enviar email:', error.response?.data || error.message);
    res.redirect('/?error=Erro ao enviar e-mail');
  }
});

// Rotas para Livros
app.post('/livros', async (req, res) => {
  try {
    const response = await axios.post(`${API_URL}/livros`, req.body);
    if (response.data.success) {
      // Após cadastrar livro com sucesso, redireciona para /
      res.redirect('/?success=Livro cadastrado com sucesso');
    } else {
      res.redirect('/?error=' + encodeURIComponent('Erro ao cadastrar livro: ' + response.data.error));
    }
  } catch (error) {
    res.redirect('/?error=Erro ao cadastrar livro');
  }
});

// Rota para atualizar livro via POST (sem PUT e sem method-override)
app.post('/livros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, autor, quantidade } = req.body;

    await axios.put(`${API_URL}/livros/${id}`, { titulo, autor, quantidade });
    res.redirect('/?success=Livro atualizado com sucesso');
  } catch (error) {
    res.redirect('/?error=Erro ao atualizar livro');
  }
});

// Rotas para Empréstimos
app.post('/emprestimos', async (req, res) => {
  try {
    await axios.post(`${API_URL}/emprestimos`, req.body);
    res.redirect('/?success=Empréstimo registrado com sucesso');
  } catch (error) {
    res.redirect('/?error=Erro ao registrar empréstimo');
  }
});

// Rota para devolver empréstimo via POST (sem DELETE e sem method-override)
app.post('/emprestimos/:id/devolver', async (req, res) => {
  try {
    await axios.delete(`${API_URL}/emprestimos/${req.params.id}`);
    res.redirect('/?success=Empréstimo devolvido com sucesso');
  } catch (error) {
    res.redirect('/?error=Erro ao registrar devolução');
  }
});

app.listen(PORT, () => {
  console.log(`Sistema de Biblioteca rodando em http://localhost:${PORT}`);
});
