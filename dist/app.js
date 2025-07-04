"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const livros_1 = __importDefault(require("./routes/livros"));
const emprestimos_1 = __importDefault(require("./routes/emprestimos"));
const client_1 = require("@prisma/client");
const method_override_1 = __importDefault(require("method-override"));
const alunos_1 = __importDefault(require("./routes/alunos"));
const usuarios_1 = require("./routes/usuarios");
const prisma = new client_1.PrismaClient();
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '10000', 10);
// Middlewares
app.use((0, cors_1.default)());
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json());
const publicPath = path_1.default.join(__dirname, '../public');
app.use(express_1.default.static(publicPath));
app.use((0, method_override_1.default)('_method'));
// Verifique se o caminho está correto
console.log(`Serving static files from: ${publicPath}`);
const viewsPath = process.env.NODE_ENV === 'production'
    ? path_1.default.join(__dirname, 'views')
    : path_1.default.join(__dirname, '../src/views');
app.set('view engine', 'ejs');
app.set('views', viewsPath);
// Rotas da API
app.use('/alunos', alunos_1.default);
app.use('/livros', livros_1.default);
app.use('/emprestimos', emprestimos_1.default);
app.use('/usuarios', usuarios_1.usuariosRouter);
app.use((0, method_override_1.default)('_method'));
app.use(express_1.default.urlencoded({ extended: true }));
// Rota principal que renderiza a página
app.get('/', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [alunos, livros, emprestimos] = yield Promise.all([
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
    }
    catch (error) {
        console.error('Erro ao carregar dados:', error);
        res.render('error', { message: 'Erro ao carregar dados' });
    }
}));
// Rotas do frontend (para formulários)
app.post('/alunos', usuarios_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield prisma.aluno.create({ data: req.body });
        res.redirect('/?success=Aluno cadastrado com sucesso');
    }
    catch (error) {
        res.redirect('/?error=Erro ao criar aluno');
    }
}));
app.post('/livros', usuarios_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield prisma.livro.create({
            data: Object.assign(Object.assign({}, req.body), { quantidade: parseInt(req.body.quantidade) })
        });
        res.redirect('/?success=Livro cadastrado com sucesso');
    }
    catch (error) {
        res.redirect('/?error=Erro ao cadastrar livro');
    }
}));
app.post('/emprestimos', usuarios_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield prisma.emprestimo.create({
            data: {
                alunoId: parseInt(req.body.alunoId),
                livroId: parseInt(req.body.livroId),
                dataEmprestimo: new Date(),
                dataDevolucao: new Date(req.body.dataDevolucao),
                devolvido: false
            }
        });
        res.redirect('/?success=Empréstimo registrado com sucesso');
    }
    catch (error) {
        res.redirect('/?error=Erro ao registrar empréstimo');
    }
}));
app.post('/emprestimos/:id/devolver', usuarios_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield prisma.emprestimo.update({
            where: { id: parseInt(req.params.id) },
            data: { devolvido: true, dataDevolucao: new Date() }
        });
        res.redirect('/?success=Empréstimo devolvido com sucesso');
    }
    catch (error) {
        res.redirect('/?error=Erro ao registrar devolução');
    }
}));
app.put('/livros/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id);
    const { titulo, autor, quantidade } = req.body;
    if (!titulo || !autor || !quantidade || isNaN(id)) {
        return res.status(400).render('index', {
            error: 'Dados inválidos para edição.',
            success: null,
            alunos: yield prisma.aluno.findMany(),
            livros: yield prisma.livro.findMany(),
            emprestimos: yield prisma.emprestimo.findMany({ include: { aluno: true, livro: true } })
        });
    }
    try {
        yield prisma.livro.update({
            where: { id },
            data: {
                titulo,
                autor,
                quantidade: parseInt(quantidade)
            }
        });
        res.redirect('/'); // Redireciona após o sucesso
    }
    catch (err) {
        console.error('Erro ao editar livro:', err);
        res.status(500).render('index', {
            error: 'Erro interno ao editar livro.',
            success: null,
            alunos: yield prisma.aluno.findMany(),
            livros: yield prisma.livro.findMany(),
            emprestimos: yield prisma.emprestimo.findMany({ include: { aluno: true, livro: true } })
        });
    }
}));
// Inicia servidor
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
