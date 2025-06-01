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
const alunos_1 = __importDefault(require("./routes/alunos"));
const livros_1 = __importDefault(require("./routes/livros"));
const emprestimos_1 = __importDefault(require("./routes/emprestimos"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Middlewares
app.use((0, cors_1.default)());
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(__dirname, '../../public')));
// Configuração do EJS
app.set('views', path_1.default.join(__dirname, '../../views'));
app.set('view engine', 'ejs');
// Rotas da API
app.use('/api/alunos', alunos_1.default);
app.use('/api/livros', livros_1.default);
app.use('/api/emprestimos', emprestimos_1.default);
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
app.post('/alunos', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield prisma.aluno.create({ data: req.body });
        res.redirect('/?success=Aluno cadastrado com sucesso');
    }
    catch (error) {
        res.redirect('/?error=Erro ao criar aluno');
    }
}));
app.post('/livros', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
app.post('/emprestimos', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
app.post('/emprestimos/:id/devolver', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
    try {
        yield prisma.livro.update({
            where: { id: parseInt(req.params.id) },
            data: {
                titulo: req.body.titulo,
                autor: req.body.autor,
                quantidade: parseInt(req.body.quantidade)
            }
        });
        res.redirect('/?success=Livro atualizado com sucesso');
    }
    catch (error) {
        res.redirect('/?error=Erro ao atualizar livro');
    }
}));
// Inicia servidor
app.listen(PORT, () => {
    console.log(`Sistema rodando na porta ${PORT}`);
});
