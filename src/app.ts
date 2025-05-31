import express from 'express';
import alunosRouter from './routes/alunos';
import livrosRouter from './routes/livros';
import emprestimosRouter from './routes/emprestimos';

const app = express();
app.use(express.json());

// Rotas
app.use('/alunos', alunosRouter);
app.use('/livros', livrosRouter);
app.use('/emprestimos', emprestimosRouter);

// Health Check
app.get('/', (req, res) => {
  res.send('Sistema de Biblioteca - API');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});