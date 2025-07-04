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
// src/routes/usuarios.ts
const client_1 = require("@prisma/client");
const express_1 = require("express");
const zod_1 = require("zod");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jwt_1 = require("../auth/jwt");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
const SALT_ROUNDS = 10;
const transporter = nodemailer_1.default.createTransport({
    host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
    port: parseInt(process.env.MAILTRAP_PORT || "2525"),
    auth: {
        user: process.env.MAILTRAP_USER || '',
        pass: process.env.MAILTRAP_PASS || ''
    }
});
const usuarioSchema = zod_1.z.object({
    nome: zod_1.z.string().min(3),
    email: zod_1.z.string().email(),
    senha: zod_1.z.string().min(8)
        .regex(/[A-Z]/, "Deve conter pelo menos uma letra maiúscula")
        .regex(/[a-z]/, "Deve conter pelo menos uma letra minúscula")
        .regex(/[0-9]/, "Deve conter pelo menos um número")
        .regex(/[^A-Za-z0-9]/, "Deve conter pelo menos um símbolo"),
    perguntaSeguranca: zod_1.z.string().min(5, "Pergunta deve ter pelo menos 5 caracteres"),
    respostaSeguranca: zod_1.z.string().min(2, "Resposta deve ter pelo menos 2 caracteres")
});
// Rotas públicas
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const validation = usuarioSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            error: "Dados inválidos",
            details: validation.error.errors
        });
    }
    try {
        const { nome, email, senha, perguntaSeguranca, respostaSeguranca } = validation.data;
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
                respostaSeguranca: yield bcrypt_1.default.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS)
            }
        });
        // Enviar email de ativação
        const mailOptions = {
            from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
            to: email,
            subject: 'Ativação de conta',
            html: `
        <h2>Olá ${nome},</h2>
        <p>Seu código de ativação é: <strong>${codigoAtivacao}</strong></p>
        <p>Use este código para ativar sua conta em nossa plataforma.</p>
        <p>Ou clique no link abaixo:</p>
        <a href="${process.env.APP_URL}/ativar-conta?email=${encodeURIComponent(email)}&codigo=${codigoAtivacao}">
          Ativar minha conta
        </a>
      `
        };
        yield transporter.sendMail(mailOptions);
        // Registrar log
        yield prisma.log.create({
            data: {
                acao: 'CADASTRO_USUARIO',
                detalhes: `Novo usuário cadastrado: ${email}`,
                usuarioId: usuario.id
            }
        });
        res.status(201).json({
            success: true,
            message: "Usuário cadastrado com sucesso. Verifique seu email para ativar a conta."
        });
    }
    catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({
                error: "Email já cadastrado"
            });
        }
        res.status(500).json({ error: "Erro ao cadastrar usuário" });
    }
}));
router.post("/login", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, senha } = req.body;
    if (!email || !senha) {
        return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }
    try {
        const usuario = yield prisma.usuario.findUnique({
            where: { email, deleted: false }
        });
        if (!usuario || !usuario.senha) {
            return res.status(401).json({ error: "Credenciais inválidas" });
        }
        if (usuario.bloqueado) {
            return res.status(403).json({
                error: "Conta bloqueada. Entre em contato com o administrador."
            });
        }
        if (usuario.status !== "ATIVO") {
            return res.status(403).json({
                error: "Conta não ativada. Verifique seu email."
            });
        }
        const senhaValida = yield bcrypt_1.default.compare(senha, usuario.senha);
        if (!senhaValida) {
            // Incrementar tentativas de login
            const tentativas = usuario.tentativasLogin + 1;
            const bloqueado = tentativas >= 3;
            yield prisma.usuario.update({
                where: { id: usuario.id },
                data: {
                    tentativasLogin: tentativas,
                    bloqueado
                }
            });
            yield prisma.log.create({
                data: {
                    acao: 'TENTATIVA_LOGIN_FALHA',
                    detalhes: `Tentativa ${tentativas} de login falhou para ${email}`,
                    usuarioId: usuario.id
                }
            });
            return res.status(401).json({
                error: 'Credenciais inválidas',
                tentativasRestantes: 3 - tentativas,
                bloqueado
            });
        }
        // Resetar tentativas de login
        yield prisma.usuario.update({
            where: { id: usuario.id },
            data: {
                tentativasLogin: 0,
                ultimoLogin: new Date()
            }
        });
        yield prisma.log.create({
            data: {
                acao: 'LOGIN',
                detalhes: `Login bem-sucedido para ${email}`,
                usuarioId: usuario.id
            }
        });
        const token = (0, jwt_1.generateToken)(usuario.id, usuario.nivelAcesso);
        const refresh = (0, jwt_1.refreshToken)(usuario.id, usuario.nivelAcesso);
        res.json({
            success: true,
            token,
            refresh,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                nivelAcesso: usuario.nivelAcesso,
                ultimoLogin: usuario.ultimoLogin
                    ? `Seu último acesso foi em ${usuario.ultimoLogin.toLocaleString()}`
                    : 'Este é seu primeiro acesso'
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: "Erro ao realizar login" });
    }
}));
router.post("/ativar", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, codigo } = req.body;
    if (!email || !codigo) {
        return res.status(400).json({ error: 'Email e código são obrigatórios' });
    }
    try {
        const usuario = yield prisma.usuario.findUnique({
            where: { email, deleted: false }
        });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        if (usuario.status === 'ATIVO') {
            return res.status(400).json({ error: 'Conta já está ativa' });
        }
        if (usuario.codigoAtivacao !== codigo) {
            return res.status(400).json({ error: 'Código de ativação inválido' });
        }
        yield prisma.usuario.update({
            where: { id: usuario.id },
            data: {
                status: 'ATIVO',
                codigoAtivacao: null
            }
        });
        yield prisma.log.create({
            data: {
                acao: 'ATIVACAO_CONTA',
                detalhes: `Usuário ativou a conta: ${email}`,
                usuarioId: usuario.id
            }
        });
        res.json({
            success: true,
            message: 'Conta ativada com sucesso',
            token: (0, jwt_1.generateToken)(usuario.id, usuario.nivelAcesso)
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao ativar conta' });
    }
}));
router.post("/recuperar-senha", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email é obrigatório' });
    }
    try {
        const usuario = yield prisma.usuario.findUnique({
            where: { email, deleted: false }
        });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        const codigoRecuperacao = Math.random().toString(36).substring(2, 6).toUpperCase();
        yield prisma.usuario.update({
            where: { id: usuario.id },
            data: { codigoAtivacao: codigoRecuperacao }
        });
        const mailOptions = {
            from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
            to: email,
            subject: 'Recuperação de senha',
            html: `
        <h2>Olá ${usuario.nome},</h2>
        <p>Seu código de recuperação é: <strong>${codigoRecuperacao}</strong></p>
        <p>Use este código para redefinir sua senha.</p>
        <p>Ou clique no link abaixo:</p>
        <a href="${process.env.APP_URL}/redefinir-senha?email=${encodeURIComponent(email)}&codigo=${codigoRecuperacao}">
          Redefinir minha senha
        </a>
      `
        };
        yield transporter.sendMail(mailOptions);
        yield prisma.log.create({
            data: {
                acao: 'SOLICITACAO_RECUPERACAO_SENHA',
                detalhes: `Solicitação de recuperação de senha para ${email}`,
                usuarioId: usuario.id
            }
        });
        res.json({
            success: true,
            message: 'Código de recuperação enviado para seu email'
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao processar recuperação de senha' });
    }
}));
router.post("/redefinir-senha", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, codigo, novaSenha } = req.body;
    if (!email || !codigo || !novaSenha) {
        return res.status(400).json({ error: 'Email, código e nova senha são obrigatórios' });
    }
    try {
        const validation = usuarioSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
        if (!validation.success) {
            return res.status(400).json({
                error: "Senha inválida",
                details: validation.error.errors
            });
        }
        const usuario = yield prisma.usuario.findUnique({
            where: { email, deleted: false }
        });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        if (usuario.codigoAtivacao !== codigo) {
            return res.status(400).json({ error: 'Código de recuperação inválido' });
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
        yield prisma.log.create({
            data: {
                acao: 'REDEFINICAO_SENHA',
                detalhes: `Senha redefinida para ${email}`,
                usuarioId: usuario.id
            }
        });
        res.json({
            success: true,
            message: 'Senha redefinida com sucesso',
            token: (0, jwt_1.generateToken)(usuario.id, usuario.nivelAcesso)
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao redefinir senha' });
    }
}));
router.post("/redefinir-senha-pergunta", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, resposta, novaSenha } = req.body;
    if (!email || !resposta || !novaSenha) {
        return res.status(400).json({ error: 'Email, resposta e nova senha são obrigatórios' });
    }
    try {
        const validation = usuarioSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
        if (!validation.success) {
            return res.status(400).json({
                error: "Senha inválida",
                details: validation.error.errors
            });
        }
        const usuario = yield prisma.usuario.findUnique({
            where: { email, deleted: false }
        });
        if (!usuario || !usuario.respostaSeguranca) {
            return res.status(404).json({ error: 'Usuário não encontrado ou sem pergunta de segurança' });
        }
        const respostaValida = yield bcrypt_1.default.compare(resposta.toLowerCase(), usuario.respostaSeguranca);
        if (!respostaValida) {
            return res.status(401).json({ error: 'Resposta de segurança incorreta' });
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
        yield prisma.log.create({
            data: {
                acao: 'REDEFINICAO_SENHA_PERGUNTA',
                detalhes: `Senha redefinida via pergunta de segurança para ${email}`,
                usuarioId: usuario.id
            }
        });
        res.json({
            success: true,
            message: 'Senha redefinida com sucesso',
            token: (0, jwt_1.generateToken)(usuario.id, usuario.nivelAcesso)
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao redefinir senha' });
    }
}));
// Rotas protegidas
router.get("/perfil", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const usuario = yield prisma.usuario.findUnique({
            where: { id: req.user.id, deleted: false },
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
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        res.json(usuario);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar perfil' });
    }
}));
router.put("/perfil", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { nome, perguntaSeguranca, respostaSeguranca } = req.body;
    try {
        const updateData = {};
        if (nome)
            updateData.nome = nome;
        if (perguntaSeguranca)
            updateData.perguntaSeguranca = perguntaSeguranca;
        if (respostaSeguranca) {
            updateData.respostaSeguranca = yield bcrypt_1.default.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS);
        }
        const usuario = yield prisma.usuario.update({
            where: { id: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id, deleted: false },
            data: updateData,
            select: {
                id: true,
                nome: true,
                email: true,
                perguntaSeguranca: true
            }
        });
        yield prisma.log.create({
            data: {
                acao: 'ATUALIZACAO_PERFIL',
                detalhes: `Usuário atualizou perfil: ${usuario.email}`,
                usuarioId: usuario.id
            }
        });
        res.json({ success: true, usuario });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar perfil' });
    }
}));
router.put("/alterar-senha", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { senhaAtual, novaSenha } = req.body;
    if (!senhaAtual || !novaSenha) {
        return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
    }
    try {
        const validation = usuarioSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
        if (!validation.success) {
            return res.status(400).json({
                error: "Senha inválida",
                details: validation.error.errors
            });
        }
        const usuario = yield prisma.usuario.findUnique({
            where: { id: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id, deleted: false }
        });
        if (!usuario || !usuario.senha) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        const senhaValida = yield bcrypt_1.default.compare(senhaAtual, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({ error: 'Senha atual incorreta' });
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
        yield prisma.log.create({
            data: {
                acao: 'ALTERACAO_SENHA',
                detalhes: `Usuário alterou senha: ${usuario.email}`,
                usuarioId: usuario.id
            }
        });
        res.json({
            success: true,
            message: 'Senha alterada com sucesso'
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao alterar senha' });
    }
}));
router.get("/logs", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const logs = yield prisma.log.findMany({
            where: { usuarioId: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json({ success: true, logs });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar logs' });
    }
}));
router.post("/backup", jwt_1.authenticateJWT, (0, jwt_1.checkPermission)(3), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const backupDir = path_1.default.join(__dirname, '../../backups');
        if (!fs_1.default.existsSync(backupDir)) {
            fs_1.default.mkdirSync(backupDir, { recursive: true });
        }
        const backupFile = path_1.default.join(backupDir, `backup-${Date.now()}.json`);
        const backupData = {
            usuarios: yield prisma.usuario.findMany({ where: { deleted: false } }),
            alunos: yield prisma.aluno.findMany({ where: { deleted: false } }),
            livros: yield prisma.livro.findMany({ where: { deleted: false } }),
            emprestimos: yield prisma.emprestimo.findMany({ where: { deleted: false } })
        };
        fs_1.default.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
        yield prisma.log.create({
            data: {
                acao: 'BACKUP',
                detalhes: `Backup realizado por ${(_a = req.user) === null || _a === void 0 ? void 0 : _a.email}`,
                usuarioId: (_b = req.user) === null || _b === void 0 ? void 0 : _b.id
            }
        });
        res.json({
            success: true,
            message: 'Backup realizado com sucesso',
            file: backupFile
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao realizar backup' });
    }
}));
router.delete("/:id", jwt_1.authenticateJWT, (0, jwt_1.checkPermission)(3), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        yield prisma.log.create({
            data: {
                acao: 'EXCLUSAO_USUARIO',
                detalhes: `Usuário ${usuario.email} excluído por ${(_a = req.user) === null || _a === void 0 ? void 0 : _a.email}`,
                usuarioId: (_b = req.user) === null || _b === void 0 ? void 0 : _b.id
            }
        });
        res.json({
            success: true,
            message: 'Usuário marcado como excluído com sucesso'
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao excluir usuário' });
    }
}));
exports.default = router;
