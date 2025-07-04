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
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const alunos_1 = __importDefault(require("./routes/alunos"));
const livros_1 = __importDefault(require("./routes/livros"));
const emprestimos_1 = __importDefault(require("./routes/emprestimos"));
const usuarios_1 = __importDefault(require("./routes/usuarios"));
const jwt_1 = require("./auth/jwt");
const fs_1 = __importDefault(require("fs"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const morgan_1 = __importDefault(require("morgan"));
const prisma = new client_1.PrismaClient();
const app = (0, express_1.default)();
app.use(body_parser_1.default.json());
const PORT = parseInt(process.env.PORT || '3000', 10);
// Enhanced security middleware
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "trusted-cdn.com"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", process.env.FRONTEND_URL || 'http://localhost:3001'],
            frameAncestors: ["'none'"],
            formAction: ["'self'"]
        }
    },
    hsts: {
        maxAge: 63072000,
        includeSubDomains: true,
        preload: true
    },
    referrerPolicy: { policy: 'same-origin' }
}));
// CORS configuration
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400
}));
// Request logging
app.use((0, morgan_1.default)('combined'));
// Rate limiting - more strict for auth endpoints
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true,
    legacyHeaders: false
});
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per windowMs
    message: 'Too many authentication attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false
});
app.use(apiLimiter);
app.use('/usuarios/login', authLimiter);
app.use('/alunos/login', authLimiter);
// Body parsing with size limits
app.use(express_1.default.json({ limit: '10kb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10kb' }));
// Static files with cache control
const publicPath = path_1.default.join(__dirname, '../public');
app.use(express_1.default.static(publicPath, {
    maxAge: '1d',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));
// Public routes
app.use('/alunos', alunos_1.default);
app.use('/usuarios', usuarios_1.default);
// Protected routes with JWT authentication
app.use('/livros', jwt_1.authenticateJWT, livros_1.default);
app.use('/emprestimos', jwt_1.authenticateJWT, emprestimos_1.default);
// Status route
app.get('/status', (_req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        security: {
            cors: true,
            helmet: true,
            rateLimiting: true,
            jwtAuth: true
        }
    });
});
// Backup route with admin permission check
app.post('/backup', jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Check if user has admin privileges
        const user = req.user || req.aluno;
        if (!user || user.nivelAcesso < 3) {
            return res.status(403).json({
                error: 'Acesso negado. Permissão insuficiente para realizar backup.'
            });
        }
        const backupDir = path_1.default.join(__dirname, '../../backups');
        if (!fs_1.default.existsSync(backupDir)) {
            fs_1.default.mkdirSync(backupDir, { recursive: true });
        }
        const backupFile = path_1.default.join(backupDir, `backup-${Date.now()}.json`);
        const backupData = {
            alunos: yield prisma.aluno.findMany(),
            livros: yield prisma.livro.findMany(),
            emprestimos: yield prisma.emprestimo.findMany(),
            usuarios: yield prisma.usuario.findMany(),
            logs: yield prisma.log.findMany()
        };
        fs_1.default.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
        // Log the backup action
        yield prisma.log.create({
            data: {
                acao: 'BACKUP_SISTEMA',
                detalhes: `Backup realizado por ${user.email}`,
                usuarioId: user.id,
                alunoId: user.id
            }
        });
        res.json({
            success: true,
            message: 'Backup realizado com sucesso',
            file: backupFile
        });
    }
    catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ error: 'Erro ao realizar backup' });
    }
}));
// Restore route with admin permission check
app.post('/restore', jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Check if user has admin privileges
        const user = req.user || req.aluno;
        if (!user || user.nivelAcesso < 3) {
            return res.status(403).json({
                error: 'Acesso negado. Permissão insuficiente para realizar restauração.'
            });
        }
        const { backupFile } = req.body;
        if (!backupFile || !fs_1.default.existsSync(backupFile)) {
            return res.status(400).json({ error: 'Arquivo de backup inválido ou não encontrado' });
        }
        const backupData = JSON.parse(fs_1.default.readFileSync(backupFile, 'utf8'));
        // Start transaction for data restoration
        yield prisma.$transaction([
            prisma.aluno.deleteMany(),
            prisma.livro.deleteMany(),
            prisma.emprestimo.deleteMany(),
            prisma.usuario.deleteMany(),
            prisma.log.deleteMany()
        ]);
        // Restore data
        yield prisma.aluno.createMany({ data: backupData.alunos });
        yield prisma.livro.createMany({ data: backupData.livros });
        yield prisma.emprestimo.createMany({ data: backupData.emprestimos });
        yield prisma.usuario.createMany({ data: backupData.usuarios });
        yield prisma.log.createMany({ data: backupData.logs });
        // Log the restore action
        yield prisma.log.create({
            data: {
                acao: 'RESTORE_SISTEMA',
                detalhes: `Restauração realizada por ${user.email} a partir do arquivo ${backupFile}`,
                usuarioId: user.id,
                alunoId: user.id
            }
        });
        res.json({
            success: true,
            message: 'Restauração realizada com sucesso',
            restored: {
                alunos: backupData.alunos.length,
                livros: backupData.livros.length,
                emprestimos: backupData.emprestimos.length,
                usuarios: backupData.usuarios.length,
                logs: backupData.logs.length
            }
        });
    }
    catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: 'Erro ao realizar restauração' });
    }
}));
// Enhanced error handling
app.use((err, req, res, _next) => {
    var _a, _b, _c;
    console.error(err.stack);
    // Log the error
    prisma.log.create({
        data: {
            acao: 'ERRO_SERVIDOR',
            detalhes: `Erro no endpoint ${req.method} ${req.path}: ${err.message}`,
            usuarioId: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id,
            alunoId: (_b = req.aluno) === null || _b === void 0 ? void 0 : _b.id
        }
    }).catch((logError) => console.error('Failed to log error:', logError));
    // Security headers for error responses
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.status(500).json({
        error: 'Erro interno do servidor',
        requestId: (_c = req.id) !== null && _c !== void 0 ? _c : null
    });
});
// Security headers middleware
app.use((_req, res, next) => {
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Feature-Policy', "geolocation 'none'; microphone 'none'; camera 'none'");
    next();
});
// Server startup with enhanced security
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('Configurações de segurança ativadas:');
    console.log('- Helmet (CSP, HSTS, etc)');
    console.log('- Rate limiting');
    console.log('- CORS restrito');
    console.log('- Autenticação JWT obrigatória para rotas protegidas');
});
// Graceful shutdown with cleanup
const shutdown = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Encerrando servidor...');
    try {
        yield prisma.$disconnect();
        server.close(() => {
            console.log('Servidor encerrado');
            process.exit(0);
        });
    }
    catch (error) {
        console.error('Erro durante o encerramento:', error);
        process.exit(1);
    }
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (error) => __awaiter(void 0, void 0, void 0, function* () {
    console.error('Uncaught Exception:', error);
    yield shutdown();
}));
process.on('unhandledRejection', (reason, promise) => __awaiter(void 0, void 0, void 0, function* () {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    yield shutdown();
}));
