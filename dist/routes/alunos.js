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
const client_1 = require("@prisma/client");
const express_1 = require("express");
const zod_1 = require("zod");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jwt_1 = require("../auth/jwt");
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
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
const alunoSchema = zod_1.z.object({
    nome: zod_1.z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
    email: zod_1.z.string().email("Email inválido"),
    matricula: zod_1.z.string().min(5, "Matrícula deve ter pelo menos 5 caracteres"),
    senha: zod_1.z.string()
        .min(8, "Senha deve ter pelo menos 8 caracteres")
        .regex(/[A-Z]/, "Senha deve conter pelo menos uma letra maiúscula")
        .regex(/[a-z]/, "Senha deve conter pelo menos uma letra minúscula")
        .regex(/[0-9]/, "Senha deve conter pelo menos um número")
        .regex(/[^A-Za-z0-9]/, "Senha deve conter pelo menos um símbolo"),
    perguntaSeguranca: zod_1.z.string().min(5, "Pergunta de segurança deve ter pelo menos 5 caracteres").optional(),
    respostaSeguranca: zod_1.z.string().min(2, "Resposta de segurança deve ter pelo menos 2 caracteres").optional()
});
// Rotas públicas
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const validation = alunoSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            error: "Dados inválidos",
            details: validation.error.errors
        });
    }
    try {
        const { nome, email, matricula, senha, perguntaSeguranca, respostaSeguranca } = validation.data;
        const hashedPassword = yield bcrypt_1.default.hash(senha, SALT_ROUNDS);
        const codigoAtivacao = Math.random().toString(36).substring(2, 6).toUpperCase();
        const aluno = yield prisma.aluno.create({
            data: {
                nome,
                email,
                matricula,
                senha: hashedPassword,
                codigoAtivacao,
                status: "INATIVO",
                perguntaSeguranca,
                respostaSeguranca: respostaSeguranca ? yield bcrypt_1.default.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS) : null
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
                acao: 'CADASTRO_ALUNO',
                detalhes: `Novo aluno cadastrado: ${email}`,
                alunoId: aluno.id
            }
        });
        res.status(201).json({
            success: true,
            message: "Aluno cadastrado com sucesso. Verifique seu email para ativar a conta."
        });
    }
    catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({
                error: "Email ou matrícula já cadastrados"
            });
        }
        res.status(500).json({ error: "Erro ao cadastrar aluno" });
    }
}));
router.post("/login", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, senha } = req.body;
    if (!email || !senha) {
        return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }
    try {
        const aluno = yield prisma.aluno.findUnique({
            where: { email, deleted: false }
        });
        if (!aluno || !aluno.senha) {
            return res.status(401).json({ error: "Credenciais inválidas" });
        }
        if (aluno.bloqueado) {
            return res.status(403).json({
                error: "Conta bloqueada. Entre em contato com o administrador."
            });
        }
        if (aluno.status !== "ATIVO") {
            return res.status(403).json({
                error: "Conta não ativada. Verifique seu email."
            });
        }
        const senhaValida = yield bcrypt_1.default.compare(senha, aluno.senha);
        if (!senhaValida) {
            // Incrementar tentativas de login
            const tentativas = aluno.tentativasLogin + 1;
            const bloqueado = tentativas >= 3;
            yield prisma.aluno.update({
                where: { id: aluno.id },
                data: {
                    tentativasLogin: tentativas,
                    bloqueado
                }
            });
            yield prisma.log.create({
                data: {
                    acao: 'TENTATIVA_LOGIN_FALHA',
                    detalhes: `Tentativa ${tentativas} de login falhou para ${email}`,
                    alunoId: aluno.id
                }
            });
            return res.status(401).json({
                error: 'Credenciais inválidas',
                tentativasRestantes: 3 - tentativas,
                bloqueado
            });
        }
        // Resetar tentativas de login
        yield prisma.aluno.update({
            where: { id: aluno.id },
            data: {
                tentativasLogin: 0,
                ultimoLogin: new Date()
            }
        });
        yield prisma.log.create({
            data: {
                acao: 'LOGIN',
                detalhes: `Login bem-sucedido para ${email}`,
                alunoId: aluno.id
            }
        });
        const token = (0, jwt_1.generateToken)(aluno.id, aluno.nivelAcesso);
        const refresh = (0, jwt_1.refreshToken)(aluno.id, aluno.nivelAcesso);
        res.json({
            success: true,
            token,
            refresh,
            aluno: {
                id: aluno.id,
                nome: aluno.nome,
                email: aluno.email,
                nivelAcesso: aluno.nivelAcesso,
                ultimoLogin: aluno.ultimoLogin
                    ? `Seu último acesso foi em ${aluno.ultimoLogin.toLocaleString()}`
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
        const aluno = yield prisma.aluno.findUnique({
            where: { email, deleted: false }
        });
        if (!aluno) {
            return res.status(404).json({ error: 'Aluno não encontrado' });
        }
        if (aluno.status === 'ATIVO') {
            return res.status(400).json({ error: 'Conta já está ativa' });
        }
        if (aluno.codigoAtivacao !== codigo) {
            return res.status(400).json({ error: 'Código de ativação inválido' });
        }
        yield prisma.aluno.update({
            where: { id: aluno.id },
            data: {
                status: 'ATIVO',
                codigoAtivacao: null
            }
        });
        yield prisma.log.create({
            data: {
                acao: 'ATIVACAO_CONTA',
                detalhes: `Aluno ativou a conta: ${email}`,
                alunoId: aluno.id
            }
        });
        res.json({
            success: true,
            message: 'Conta ativada com sucesso',
            token: (0, jwt_1.generateToken)(aluno.id, aluno.nivelAcesso)
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
        const aluno = yield prisma.aluno.findUnique({
            where: { email, deleted: false }
        });
        if (!aluno) {
            return res.status(404).json({ error: 'Aluno não encontrado' });
        }
        const codigoRecuperacao = Math.random().toString(36).substring(2, 6).toUpperCase();
        yield prisma.aluno.update({
            where: { id: aluno.id },
            data: { codigoAtivacao: codigoRecuperacao }
        });
        const mailOptions = {
            from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
            to: email,
            subject: 'Recuperação de senha',
            html: `
        <h2>Olá ${aluno.nome},</h2>
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
                alunoId: aluno.id
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
        const validation = alunoSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
        if (!validation.success) {
            return res.status(400).json({
                error: "Senha inválida",
                details: validation.error.errors
            });
        }
        const aluno = yield prisma.aluno.findUnique({
            where: { email, deleted: false }
        });
        if (!aluno) {
            return res.status(404).json({ error: 'Aluno não encontrado' });
        }
        if (aluno.codigoAtivacao !== codigo) {
            return res.status(400).json({ error: 'Código de recuperação inválido' });
        }
        const hashedPassword = yield bcrypt_1.default.hash(novaSenha, SALT_ROUNDS);
        yield prisma.aluno.update({
            where: { id: aluno.id },
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
                alunoId: aluno.id
            }
        });
        res.json({
            success: true,
            message: 'Senha redefinida com sucesso',
            token: (0, jwt_1.generateToken)(aluno.id, aluno.nivelAcesso)
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
        const validation = alunoSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
        if (!validation.success) {
            return res.status(400).json({
                error: "Senha inválida",
                details: validation.error.errors
            });
        }
        const aluno = yield prisma.aluno.findUnique({
            where: { email, deleted: false }
        });
        if (!aluno || !aluno.respostaSeguranca) {
            return res.status(404).json({ error: 'Aluno não encontrado ou sem pergunta de segurança' });
        }
        const respostaValida = yield bcrypt_1.default.compare(resposta.toLowerCase(), aluno.respostaSeguranca);
        if (!respostaValida) {
            return res.status(401).json({ error: 'Resposta de segurança incorreta' });
        }
        const hashedPassword = yield bcrypt_1.default.hash(novaSenha, SALT_ROUNDS);
        yield prisma.aluno.update({
            where: { id: aluno.id },
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
                alunoId: aluno.id
            }
        });
        res.json({
            success: true,
            message: 'Senha redefinida com sucesso',
            token: (0, jwt_1.generateToken)(aluno.id, aluno.nivelAcesso)
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao redefinir senha' });
    }
}));
// Rotas protegidas
router.get("/perfil", jwt_1.authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!req.aluno) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const aluno = yield prisma.aluno.findUnique({
            where: { id: req.aluno.id, deleted: false },
            select: {
                id: true,
                nome: true,
                email: true,
                matricula: true,
                status: true,
                nivelAcesso: true,
                ultimoLogin: true,
                perguntaSeguranca: true,
                createdAt: true
            }
        });
        if (!aluno) {
            return res.status(404).json({ error: 'Aluno não encontrado' });
        }
        res.json(aluno);
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
        const aluno = yield prisma.aluno.update({
            where: { id: (_a = req.aluno) === null || _a === void 0 ? void 0 : _a.id, deleted: false },
            data: updateData,
            select: {
                id: true,
                nome: true,
                email: true,
                matricula: true,
                perguntaSeguranca: true
            }
        });
        yield prisma.log.create({
            data: {
                acao: 'ATUALIZACAO_PERFIL',
                detalhes: `Aluno atualizou perfil: ${aluno.email}`,
                alunoId: aluno.id
            }
        });
        res.json({ success: true, aluno });
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
        const validation = alunoSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
        if (!validation.success) {
            return res.status(400).json({
                error: "Senha inválida",
                details: validation.error.errors
            });
        }
        const aluno = yield prisma.aluno.findUnique({
            where: { id: (_a = req.aluno) === null || _a === void 0 ? void 0 : _a.id, deleted: false }
        });
        if (!aluno || !aluno.senha) {
            return res.status(404).json({ error: 'Aluno não encontrado' });
        }
        const senhaValida = yield bcrypt_1.default.compare(senhaAtual, aluno.senha);
        if (!senhaValida) {
            return res.status(401).json({ error: 'Senha atual incorreta' });
        }
        const hashedPassword = yield bcrypt_1.default.hash(novaSenha, SALT_ROUNDS);
        yield prisma.aluno.update({
            where: { id: aluno.id },
            data: {
                senha: hashedPassword,
                bloqueado: false,
                tentativasLogin: 0
            }
        });
        yield prisma.log.create({
            data: {
                acao: 'ALTERACAO_SENHA',
                detalhes: `Aluno alterou senha: ${aluno.email}`,
                alunoId: aluno.id
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
router.get("/logs", jwt_1.authenticateJWT, (0, jwt_1.checkPermission)(3), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const logs = yield prisma.log.findMany({
            where: { alunoId: (_a = req.aluno) === null || _a === void 0 ? void 0 : _a.id },
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
            alunos: yield prisma.aluno.findMany({ where: { deleted: false } }),
            livros: yield prisma.livro.findMany({ where: { deleted: false } }),
            emprestimos: yield prisma.emprestimo.findMany({ where: { deleted: false } })
        };
        fs_1.default.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
        yield prisma.log.create({
            data: {
                acao: 'BACKUP',
                detalhes: `Backup realizado por ${(_a = req.aluno) === null || _a === void 0 ? void 0 : _a.email}`,
                alunoId: (_b = req.aluno) === null || _b === void 0 ? void 0 : _b.id
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
        const aluno = yield prisma.aluno.update({
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
                acao: 'EXCLUSAO_ALUNO',
                detalhes: `Aluno ${aluno.email} excluído por ${(_a = req.aluno) === null || _a === void 0 ? void 0 : _a.email}`,
                alunoId: (_b = req.aluno) === null || _b === void 0 ? void 0 : _b.id
            }
        });
        res.json({
            success: true,
            message: 'Aluno marcado como excluído com sucesso'
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao excluir aluno' });
    }
}));
// Função auxiliar para gerar HTML do email
// function generateEmailHtml(aluno: Aluno & { emprestimos: EmprestimoComLivro[] }): string {
//   return `
//     <div style="font-family: Arial, sans-serif; padding: 20px;">
//       <h2 style="color: #2c3e50;">Histórico de Empréstimos Ativos</h2>
//       <p>Aluno: <strong>${aluno.nome}</strong> (Matrícula: ${aluno.matricula})</p>
//       <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
//         <thead>
//           <tr style="background-color: #f8f9fa;">
//             <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Livro</th>
//             <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Autor</th>
//             <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Empréstimo</th>
//             <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Devolução</th>
//           </tr>
//         </thead>
//         <tbody>
//           ${aluno.emprestimos.map((emp: EmprestimoComLivro) => {
//             const livro = emp.livro ?? { titulo: 'Livro não encontrado', autor: 'N/A', quantidade: 0 };
//             return `
//               <tr>
//                 <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.titulo}</td>
//                 <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.autor}</td>
//                 <td style="padding: 10px; border-bottom: 1px solid #ddd;">${new Date(emp.dataEmprestimo).toLocaleDateString('pt-BR')}</td>
//                 <td style="padding: 10px; border-bottom: 1px solid #ddd;">
//                   ${emp.dataDevolucao ? new Date(emp.dataDevolucao).toLocaleDateString('pt-BR') : 'Pendente'}
//                 </td>
//               </tr>
//             `;
//           }).join('')}
//         </tbody>
//       </table>
//     </div>
//   `;
// }
// Encerramento correto do Prisma
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
exports.default = router;
