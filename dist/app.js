"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
const PORT = 3001;
const API_URL = 'http://localhost:3000';
// Middlewares
app.use((0, cors_1.default)());
app.use(body_parser_1.default.urlencoded({ extended: true }));
app.use(body_parser_1.default.json());
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
app.set('views', path_1.default.join(__dirname, '../views')); // Caminho absoluto
app.set('view engine', 'ejs');
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
;
const handleError = (error) => {
    if (axios_1.default.isAxiosError(error)) {
        if (error.response?.data?.error) {
            return error.response.data.error;
        }
        if (error.response?.data?.message) {
            return error.response.data.message;
        }
        if (error.response?.data) {
            return JSON.stringify(error.response.data);
        }
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return 'Erro desconhecido';
};
// Rotas
app.get('/', async (req, res) => {
    // Adiciona headers para evitar cache
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const [alunos, livros, emprestimos] = await Promise.all([
            axios_1.default.get(`${API_URL}/alunos`).catch(() => ({ data: [] })),
            axios_1.default.get(`${API_URL}/livros`).catch(() => ({ data: [] })),
            axios_1.default.get(`${API_URL}/emprestimos`).catch(() => ({ data: [] }))
        ]);
        res.render('index', {
            alunos: alunos.data,
            livros: livros.data,
            emprestimos: emprestimos.data,
            success: req.query.success,
            error: req.query.error
        });
    }
    catch (error) {
        console.error('Erro ao carregar dados:', error);
        res.render('error', {
            message: 'Erro ao carregar dados',
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
// Rotas para Alunos
app.post('/alunos', async (req, res) => {
    try {
        const alunoData = {
            nome: req.body.nome,
            email: req.body.email,
            matricula: req.body.matricula
        };
        console.log('Dados recebidos:', alunoData); // Adicione para debug
        const response = await axios_1.default.post(`${API_URL}/alunos`, alunoData);
        res.redirect('/?success=Aluno cadastrado com sucesso');
    }
    catch (error) {
        console.error('Erro ao cadastrar aluno:', error);
        const message = handleError(error);
        res.redirect(`/?error=${encodeURIComponent(message)}`);
    }
});
app.post('/alunos/:id/email', async (req, res) => {
    try {
        await axios_1.default.post(`${API_URL}/alunos/${req.params.id}/email`);
        res.redirect('/?success=E-mail enviado com sucesso');
    }
    catch (error) {
        const message = handleError(error);
        res.redirect(`/?error=${encodeURIComponent(message)}`);
    }
});
// Rotas para Livros
app.post('/livros', async (req, res) => {
    try {
        const livroData = {
            titulo: req.body.titulo,
            autor: req.body.autor,
            quantidade: parseInt(req.body.quantidade)
        };
        const response = await axios_1.default.post(`${API_URL}/livros`, livroData);
        // Verifique se a resposta contém os dados esperados
        if (response.data.success && response.data.livro) {
            res.redirect('/?success=Livro cadastrado com sucesso');
        }
        else {
            res.redirect(`/?error=${encodeURIComponent(response.data.error || 'Erro desconhecido')}`);
        }
    }
    catch (error) {
        const message = handleError(error);
        res.redirect(`/?error=${encodeURIComponent(message)}`);
    }
});
// Rotas para Empréstimos
app.post('/emprestimos', async (req, res) => {
    console.log('Dados recebidos:', req.body); // Adicione este log
    try {
        const emprestimoData = {
            alunoId: Number(req.body.alunoId),
            livroId: Number(req.body.livroId),
            dataDevolucao: req.body.dataDevolucao
        };
        console.log('Dados processados:', emprestimoData); // Log dos dados processados
        const response = await axios_1.default.post(`${API_URL}/emprestimos`, emprestimoData);
        console.log('Resposta da API:', response.data); // Log da resposta
        res.redirect('/?success=Empréstimo registrado com sucesso');
    }
    catch (error) {
        console.error('Erro no servidor:', error); // Log detalhado do erro
        const message = handleError(error);
        res.redirect(`/?error=${encodeURIComponent(message)}`);
    }
});
app.post('/emprestimos/:id/devolver', async (req, res) => {
    try {
        await axios_1.default.delete(`${API_URL}/emprestimos/${req.params.id}`);
        res.redirect('/?success=Devolução registrada com sucesso');
    }
    catch (error) {
        const message = handleError(error);
        res.redirect(`/?error=${encodeURIComponent(message)}`);
    }
});
app.put('/livros/:id', async (req, res) => {
    try {
        const response = await axios_1.default.put(`${API_URL}/livros/${req.params.id}`, req.body);
        res.redirect('/?success=Livro atualizado com sucesso');
    }
    catch (error) {
        const message = handleError(error);
        res.redirect(`/?error=${encodeURIComponent(message)}`);
    }
});
// Middleware para tratamento de erros
app.use((err, req, res, next) => {
    console.error('Erro no middleware:', err);
    res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        details: err.message
    });
});
// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Sistema de Biblioteca rodando em http://localhost:${PORT}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Porta ${PORT} já está em uso.`);
        process.exit(1);
    }
});
