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
exports.refreshToken = exports.generateToken = void 0;
const client_1 = require("@prisma/client");
const express_1 = require("express");
const zod_1 = require("zod");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const jwt_1 = require("../auth/jwt");
const router = (0, express_1.Router)();
const SALT_ROUNDS = 10;
// Prisma client instance
const prisma = new client_1.PrismaClient();
// Middleware para checar permissão de acesso
function checkPermission(nivelMinimo) {
    return (req, res, next) => {
        if (req.user && req.user.nivelAcesso >= nivelMinimo) {
            return next();
        }
        return res.status(403).json({ success: false, error: 'Permissão insuficiente' });
    };
}
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'your_refresh_secret_here';
// const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '1h';
// const REFRESH_EXPIRY = process.env.REFRESH_EXPIRY || '7d';
// Rate limiting for authentication endpoints
const authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: 'Too many attempts, please try again later'
});
// Email transporter configuration
const transporter = nodemailer_1.default.createTransport({
    host: process.env.MAIL_HOST || 'smtp.example.com',
    port: parseInt(process.env.MAIL_PORT || '587'),
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    },
    tls: {
        rejectUnauthorized: false // For self-signed certificates
    }
});
// Zod validation schemas
const usuarioSchema = zod_1.z.object({
    nome: zod_1.z.string()
        .min(3, "Nome deve ter pelo menos 3 caracteres")
        .max(100, "Nome deve ter no máximo 100 caracteres"),
    email: zod_1.z.string()
        .email("Email inválido")
        .max(100, "Email deve ter no máximo 100 caracteres"),
    senha: zod_1.z.string()
        .min(8, "Senha deve ter pelo menos 8 caracteres")
        .max(100, "Senha deve ter no máximo 100 caracteres")
        .regex(/[A-Z]/, "Senha deve conter pelo menos uma letra maiúscula")
        .regex(/[a-z]/, "Senha deve conter pelo menos uma letra minúscula")
        .regex(/[0-9]/, "Senha deve conter pelo menos um número")
        .regex(/[^A-Za-z0-9]/, "Senha deve conter pelo menos um símbolo"),
    perguntaSeguranca: zod_1.z.string()
        .min(5, "Pergunta deve ter pelo menos 5 caracteres")
        .max(200, "Pergunta deve ter no máximo 200 caracteres")
        .optional(),
    respostaSeguranca: zod_1.z.string()
        .min(2, "Resposta deve ter pelo menos 2 caracteres")
        .max(100, "Resposta deve ter no máximo 100 caracteres")
        .optional()
});
const activateAccountSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    codigo: zod_1.z.string().length(4, "Código deve ter 4 caracteres")
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    senha: zod_1.z.string().min(8)
});
const passwordResetSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    codigo: zod_1.z.string().length(4, "Código deve ter 4 caracteres").optional(),
    resposta: zod_1.z.string().min(2).optional(),
    novaSenha: zod_1.z.string().min(8)
}).superRefine((data, ctx) => {
    if (!data.codigo && !data.resposta) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "Código ou resposta de segurança é obrigatório"
        });
    }
});
// Utility functions
const generateToken = (userId, nivelAcesso) => {
    return jsonwebtoken_1.default.sign({ id: userId, nivel: nivelAcesso }, process.env.JWT_SECRET || 'your_secret_key', { expiresIn: '1h' });
};
exports.generateToken = generateToken;
const refreshToken = (userId, nivelAcesso) => {
    return jsonwebtoken_1.default.sign({ id: userId, nivel: nivelAcesso }, process.env.REFRESH_SECRET || 'your_refresh_secret', { expiresIn: '7d' });
};
exports.refreshToken = refreshToken;
function sendActivationEmail(email, nome, codigo) {
    return __awaiter(this, void 0, void 0, function* () {
        const mailOptions = {
            from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
            to: email,
            subject: 'Ativação de conta',
            html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50;">Olá ${nome},</h2>
        <p>Seu código de ativação é: <strong style="font-size: 1.2em;">${codigo}</strong></p>
        <p>Use este código para ativar sua conta em nossa plataforma.</p>
        <p>Ou clique no link abaixo:</p>
        <div style="margin: 20px 0;">
          <a href="${process.env.APP_URL}/ativar-conta?email=${encodeURIComponent(email)}&codigo=${codigo}" 
             style="display: inline-block; padding: 10px 20px; background-color: #5c43e7; color: white; text-decoration: none; border-radius: 4px;">
            Ativar minha conta
          </a>
        </div>
        <p style="font-size: 0.9em; color: #7f8c8d;">
          Se você não solicitou este e-mail, por favor ignore esta mensagem.
        </p>
      </div>
    `
        };
        yield transporter.sendMail(mailOptions);
    });
}
function logAction(acao, detalhes, usuarioId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prisma.log.create({
            data: {
                acao,
                detalhes,
                usuarioId
            }
        });
    });
}
// Error handling middleware
function handleError(res, error, action) {
    console.error(`Error during ${action}:`, error);
    if (error instanceof zod_1.z.ZodError) {
        return res.status(400).json({
            success: false,
            error: "Validation error",
            details: error.errors
        });
    }
    if (error instanceof Error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
    res.status(500).json({
        success: false,
        error: "An unexpected error occurred"
    });
}
// Routes
router.post("/", authRateLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const validation = usuarioSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: "Validation error",
                details: validation.error.errors
            });
        }
        const { nome, email, senha, perguntaSeguranca, respostaSeguranca } = validation.data;
        // Check if email already exists
        const existingUser = yield prisma.usuario.findUnique({
            where: { email }
        });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: "Email já cadastrado"
            });
        }
        const hashedPassword = yield bcrypt_1.default.hash(senha, SALT_ROUNDS);
        const codigoAtivacao = Math.random().toString(36).substring(2, 6).toUpperCase();
        const usuario = yield prisma.usuario.create({
            data: {
                nome,
                email,
                senha: hashedPassword,
                codigoAtivacao,
                status: "INATIVO",
                perguntaSeguranca,
                respostaSeguranca: respostaSeguranca
                    ? yield bcrypt_1.default.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS)
                    : null
            }
        });
        // Send activation email
        yield sendActivationEmail(email, nome, codigoAtivacao);
        // Log the registration
        yield logAction('CADASTRO_USUARIO', `Novo usuário cadastrado: ${email}`, usuario.id);
        res.status(201).json({
            success: true,
            message: "Usuário cadastrado com sucesso. Verifique seu email para ativar a conta."
        });
    }
    catch (error) {
        handleError(res, error, "user registration");
    }
}));
router.post("/ativar", authRateLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const validation = activateAccountSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: "Validation error",
                details: validation.error.errors
            });
        }
        const { email, codigo } = validation.data;
        const usuario = yield prisma.usuario.findFirst({
            where: {
                email,
                deleted: false
            }
        });
        if (!usuario) {
            return res.status(404).json({
                success: false,
                error: 'Usuário não encontrado'
            });
        }
        if (usuario.status === 'ATIVO') {
            return res.status(400).json({
                success: false,
                error: 'Conta já está ativada'
            });
        }
        if (usuario.codigoAtivacao !== codigo) {
            return res.status(400).json({
                success: false,
                error: 'Código de ativação inválido'
            });
        }
        yield prisma.usuario.update({
            where: { id: usuario.id },
            data: {
                status: 'ATIVO',
                codigoAtivacao: null
            }
        });
        yield logAction('ATIVACAO_CONTA', `Usuário ativou a conta: ${email}`, usuario.id);
        const token = (0, exports.generateToken)(usuario.id, usuario.nivelAcesso);
        const newRefreshToken = (0, exports.refreshToken)(usuario.id, usuario.nivelAcesso);
        res.json({
            success: true,
            data: {
                token,
                refreshToken: newRefreshToken,
                usuario: {
                    id: usuario.id,
                    nome: usuario.nome,
                    email: usuario.email,
                    nivelAcesso: usuario.nivelAcesso
                }
            },
            message: 'Conta ativada com sucesso'
        });
    }
    catch (error) {
        handleError(res, error, "account activation");
    }
}));
// LOGIN ROUTE FIXED
router.post("/login", authRateLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const validation = loginSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: "Validation error",
                details: validation.error.errors
            });
        }
        const { email, senha } = validation.data;
        const usuario = yield prisma.usuario.findFirst({
            where: {
                email,
                deleted: false
            }
        });
        if (!usuario || !usuario.senha) {
            return res.status(401).json({
                success: false,
                error: "Credenciais inválidas"
            });
        }
        if (usuario.bloqueado) {
            return res.status(403).json({
                success: false,
                error: "Conta bloqueada. Entre em contato com o administrador."
            });
        }
        if (usuario.status !== "ATIVO") {
            return res.status(403).json({
                success: false,
                error: "Conta não ativada. Verifique seu email."
            });
        }
        const senhaValida = yield bcrypt_1.default.compare(senha, usuario.senha);
        if (!senhaValida) {
            // Increment login attempts
            const tentativas = usuario.tentativasLogin + 1;
            const bloqueado = tentativas >= 3;
            yield prisma.usuario.update({
                where: { id: usuario.id },
                data: {
                    tentativasLogin: tentativas,
                    bloqueado
                }
            });
            yield logAction('TENTATIVA_LOGIN_FALHA', `Tentativa ${tentativas} de login falhou para ${email}`, usuario.id);
            return res.status(401).json({
                success: false,
                error: 'Credenciais inválidas',
                data: {
                    tentativasRestantes: 3 - tentativas,
                    bloqueado
                }
            });
        }
        // Reset login attempts on successful login
        yield prisma.usuario.update({
            where: { id: usuario.id },
            data: {
                tentativasLogin: 0,
                ultimoLogin: new Date()
            }
        });
        yield logAction('LOGIN', `Login bem-sucedido para ${email}`, usuario.id);
        const token = (0, exports.generateToken)(usuario.id, usuario.nivelAcesso);
        const newRefreshToken = (0, exports.refreshToken)(usuario.id, usuario.nivelAcesso);
        res.json({
            success: true,
            data: {
                token,
                refreshToken: newRefreshToken,
                usuario: {
                    id: usuario.id,
                    nome: usuario.nome,
                    email: usuario.email,
                    nivelAcesso: usuario.nivelAcesso,
                    ultimoLogin: usuario.ultimoLogin
                        ? usuario.ultimoLogin.toISOString()
                        : null
                }
            }
        });
    }
    catch (error) {
        handleError(res, error, "user login");
    }
}));
router.post("/refresh-token", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(401).json({
            success: false,
            error: 'Refresh token não fornecido'
        });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(refreshToken, REFRESH_SECRET);
        const usuario = yield prisma.usuario.findFirst({
            where: {
                id: decoded.id,
                deleted: false
            }
        });
        if (!usuario || usuario.bloqueado || usuario.status !== 'ATIVO') {
            return res.status(403).json({
                success: false,
                error: 'Acesso negado. Conta inativa ou bloqueada.'
            });
        }
        const newToken = (0, exports.generateToken)(usuario.id, usuario.nivelAcesso);
        const newRefreshToken = refreshToken(usuario.id, usuario.nivelAcesso);
        res.json({
            success: true,
            data: {
                token: newToken,
                refreshToken: newRefreshToken
            }
        });
    }
    catch (error) {
        res.status(403).json({
            success: false,
            error: 'Refresh token inválido ou expirado'
        });
    }
}));
router.post("/recuperar-senha", authRateLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email é obrigatório'
            });
        }
        const usuario = yield prisma.usuario.findFirst({
            where: {
                email,
                deleted: false
            }
        });
        if (!usuario) {
            return res.status(404).json({
                success: false,
                error: 'Usuário não encontrado'
            });
        }
        const codigoRecuperacao = Math.random().toString(36).substring(2, 6).toUpperCase();
        yield prisma.usuario.update({
            where: { id: usuario.id },
            data: { codigoAtivacao: codigoRecuperacao }
        });
        yield transporter.sendMail({
            from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
            to: email,
            subject: 'Recuperação de senha',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">Olá ${usuario.nome},</h2>
          <p>Seu código de recuperação é: <strong style="font-size: 1.2em;">${codigoRecuperacao}</strong></p>
          <p>Use este código para redefinir sua senha.</p>
          <p>Ou clique no link abaixo:</p>
          <div style="margin: 20px 0;">
            <a href="${process.env.APP_URL}/redefinir-senha?email=${encodeURIComponent(email)}&codigo=${codigoRecuperacao}" 
               style="display: inline-block; padding: 10px 20px; background-color: #5c43e7; color: white; text-decoration: none; border-radius: 4px;">
              Redefinir minha senha
            </a>
          </div>
          <p style="font-size: 0.9em; color: #7f8c8d;">
            Se você não solicitou a redefinição de senha, por favor ignore este e-mail.
          </p>
        </div>
      `
        });
        yield logAction('SOLICITACAO_RECUPERACAO_SENHA', `Solicitação de recuperação de senha para ${email}`, usuario.id);
        res.json({
            success: true,
            message: 'Código de recuperação enviado para seu email'
        });
    }
    catch (error) {
        handleError(res, error, "password recovery request");
    }
}));
router.post("/redefinir-senha", authRateLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const validation = passwordResetSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: "Validation error",
                details: validation.error.errors
            });
        }
        const { email, codigo, resposta, novaSenha } = validation.data;
        const usuario = yield prisma.usuario.findFirst({
            where: {
                email,
                deleted: false
            }
        });
        if (!usuario) {
            return res.status(404).json({
                success: false,
                error: 'Usuário não encontrado'
            });
        }
        // Verify either code or security answer
        if (codigo) {
            if (usuario.codigoAtivacao !== codigo) {
                return res.status(400).json({
                    success: false,
                    error: 'Código de recuperação inválido'
                });
            }
        }
        else if (resposta && usuario.respostaSeguranca) {
            const respostaValida = yield bcrypt_1.default.compare(resposta.toLowerCase(), usuario.respostaSeguranca);
            if (!respostaValida) {
                return res.status(401).json({
                    success: false,
                    error: 'Resposta de segurança incorreta'
                });
            }
        }
        else {
            return res.status(400).json({
                success: false,
                error: 'Código ou resposta de segurança é obrigatório'
            });
        }
        const hashedPassword = yield bcrypt_1.default.hash(novaSenha, SALT_ROUNDS);
        yield prisma.usuario.update({
            where: { id: usuario.id },
            data: {
                senha: hashedPassword,
                codigoAtivacao: null,
                bloqueado: false,
                tentativasLogin: 0
            }
        });
        yield logAction('REDEFINICAO_SENHA', `Senha redefinida para ${email}`, usuario.id);
        const token = (0, exports.generateToken)(usuario.id, usuario.nivelAcesso);
        const newRefreshToken = (0, exports.refreshToken)(usuario.id, usuario.nivelAcesso);
        res.json({
            success: true,
            data: {
                token,
                refreshToken: newRefreshToken
            },
            message: 'Senha redefinida com sucesso'
        });
    }
    catch (error) {
        handleError(res, error, "password reset");
    }
}));
// Authenticated routes
router.get("/perfil", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const usuario = yield prisma.usuario.findUnique({
            where: { id: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id },
            select: {
                id: true,
                nome: true,
                email: true,
                status: true,
                nivelAcesso: true,
                ultimoLogin: true,
                perguntaSeguranca: true,
                createdAt: true
            }
        });
        if (!usuario) {
            return res.status(404).json({
                success: false,
                error: 'Usuário não encontrado'
            });
        }
        res.json({
            success: true,
            data: usuario
        });
    }
    catch (error) {
        handleError(res, error, "fetching user profile");
    }
}));
router.put("/perfil", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { nome, perguntaSeguranca, respostaSeguranca } = req.body;
        const updateData = {};
        if (nome)
            updateData.nome = nome;
        if (perguntaSeguranca)
            updateData.perguntaSeguranca = perguntaSeguranca;
        if (respostaSeguranca) {
            updateData.respostaSeguranca = yield bcrypt_1.default.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS);
        }
        const usuario = yield prisma.usuario.update({
            where: { id: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id },
            data: updateData,
            select: {
                id: true,
                nome: true,
                email: true,
                perguntaSeguranca: true
            }
        });
        yield logAction('ATUALIZACAO_PERFIL', `Usuário atualizou perfil: ${usuario.email}`, usuario.id);
        res.json({
            success: true,
            data: usuario
        });
    }
    catch (error) {
        handleError(res, error, "updating user profile");
    }
}));
router.put("/alterar-senha", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { senhaAtual, novaSenha } = req.body;
        if (!senhaAtual || !novaSenha) {
            return res.status(400).json({
                success: false,
                error: 'Senha atual e nova senha são obrigatórias'
            });
        }
        const validation = usuarioSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: "Validation error",
                details: validation.error.errors
            });
        }
        const usuario = yield prisma.usuario.findUnique({
            where: { id: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id }
        });
        if (!usuario || !usuario.senha) {
            return res.status(404).json({
                success: false,
                error: 'Usuário não encontrado'
            });
        }
        const senhaValida = yield bcrypt_1.default.compare(senhaAtual, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({
                success: false,
                error: 'Senha atual incorreta'
            });
        }
        const hashedPassword = yield bcrypt_1.default.hash(novaSenha, SALT_ROUNDS);
        yield prisma.usuario.update({
            where: { id: usuario.id },
            data: {
                senha: hashedPassword,
                bloqueado: false,
                tentativasLogin: 0
            }
        });
        yield logAction('ALTERACAO_SENHA', `Usuário alterou senha: ${usuario.email}`, usuario.id);
        res.json({
            success: true,
            message: 'Senha alterada com sucesso'
        });
    }
    catch (error) {
        handleError(res, error, "changing password");
    }
}));
// Route to fetch user logs
router.get("/logs", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const logs = yield prisma.log.findMany({
            where: { usuarioId: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json({
            success: true,
            data: logs
        });
    }
    catch (error) {
        handleError(res, error, "fetching logs");
    }
}));
router.get("/", jwt_1.authenticateJWT, checkPermission(3), (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const usuarios = yield prisma.usuario.findMany({
            where: { deleted: false },
            select: {
                id: true,
                nome: true,
                email: true,
                status: true,
                nivelAcesso: true,
                bloqueado: true,
                ultimoLogin: true,
                createdAt: true
            }
        });
        res.json({
            success: true,
            data: usuarios
        });
    }
    catch (error) {
        handleError(res, error, "fetching users");
    }
}));
router.put("/:id", jwt_1.authenticateJWT, checkPermission(3), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { nivelAcesso, bloqueado } = req.body;
        const usuario = yield prisma.usuario.update({
            where: { id: Number(req.params.id) },
            data: {
                nivelAcesso,
                bloqueado
            },
            select: {
                id: true,
                nome: true,
                email: true,
                status: true,
                nivelAcesso: true,
                bloqueado: true
            }
        });
        yield logAction('ATUALIZACAO_USUARIO', `Usuário ${usuario.email} atualizado por ${(_a = req.user) === null || _a === void 0 ? void 0 : _a.email}`, (_b = req.user) === null || _b === void 0 ? void 0 : _b.id);
        res.json({
            success: true,
            data: usuario
        });
    }
    catch (error) {
        handleError(res, error, "updating user");
    }
}));
router.delete("/:id", jwt_1.authenticateJWT, checkPermission(3), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const usuario = yield prisma.usuario.update({
            where: { id: Number(req.params.id) },
            data: {
                deleted: true,
                deletedAt: new Date(),
                status: 'INATIVO',
                bloqueado: true
            }
        });
        yield logAction('EXCLUSAO_USUARIO', `Usuário ${usuario.email} excluído por ${(_a = req.user) === null || _a === void 0 ? void 0 : _a.email}`, (_b = req.user) === null || _b === void 0 ? void 0 : _b.id);
        res.json({
            success: true,
            message: 'Usuário marcado como excluído com sucesso'
        });
    }
    catch (error) {
        handleError(res, error, "deleting user");
    }
}));
exports.default = router;
