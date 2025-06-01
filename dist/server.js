"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const alunos_1 = __importDefault(require("./routes/alunos"));
const livros_1 = __importDefault(require("./routes/livros"));
const emprestimos_1 = __importDefault(require("./routes/emprestimos"));
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '10000');
// Middlewares
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Rotas
app.use('/alunos', alunos_1.default);
app.use('/livros', livros_1.default);
app.use('/emprestimos', emprestimos_1.default);
// Middleware de erro global
app.use((err, req, res, next) => {
    console.error('Erro global:', err);
    res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        details: err.message
    });
});
// Inicia o servidor e captura a instância
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor backend rodando na porta ${PORT}`);
  });
// Tratamento de erros do servidor (ex: porta em uso)
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Porta ${PORT} já está em uso.`);
        process.exit(1);
    }
    else {
        console.error('Erro no servidor:', err.message);
    }
});
