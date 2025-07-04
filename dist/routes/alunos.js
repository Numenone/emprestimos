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
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
// Rate limiting para endpoint de email
const emailRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // máximo 5 requisições por IP nesse período
    message: 'Muitas requisições de email desse IP, tente novamente mais tarde'
});
// Validação com Zod
const alunoSchema = zod_1.z.object({
    nome: zod_1.z.string().min(3, { message: "Nome deve ter pelo menos 3 caracteres" }),
    email: zod_1.z.string().email({ message: "Email inválido" }),
    matricula: zod_1.z.string().min(5, { message: "Matrícula deve ter pelo menos 5 caracteres" })
});
// Configuração do Nodemailer
const mailConfig = {
    host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
    port: parseInt(process.env.MAILTRAP_PORT || "2525"), // Porta padrão do Mailtrap
    secure: false,
    auth: {
        user: process.env.MAILTRAP_USER || '',
        pass: process.env.MAILTRAP_PASS || ''
    },
    tls: {
        rejectUnauthorized: false
    }
};
// Verificação mais robusta das variáveis de ambiente
if (!process.env.MAILTRAP_HOST || !process.env.MAILTRAP_USER || !process.env.MAILTRAP_PASS) {
    console.error('❌ Erro: Configuração do Mailtrap incompleta!');
    console.error('Por favor, defina as seguintes variáveis no .env:');
    console.error('MAILTRAP_HOST, MAILTRAP_USER, MAILTRAP_PASS');
}
else {
    console.log('✅ Configuração do Mailtrap detectada');
}
const transporter = nodemailer_1.default.createTransport(mailConfig);
// GET todos os alunos com paginação
router.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const skip = (page - 1) * pageSize;
    try {
        const [alunos, total] = yield Promise.all([
            prisma.aluno.findMany({
                skip,
                take: pageSize,
                orderBy: { nome: 'asc' }
            }),
            prisma.aluno.count()
        ]);
        res.json({
            data: alunos,
            pagination: {
                page,
                pageSize,
                totalItems: total,
                totalPages: Math.ceil(total / pageSize)
            }
        });
    }
    catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({
            error: "Erro ao buscar alunos",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
// POST criar aluno
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Dados recebidos no backend:', req.body);
    const valida = alunoSchema.safeParse(req.body);
    if (!valida.success) {
        console.log('Erro de validação:', valida.error.errors);
        return res.status(400).json({
            error: "Dados inválidos",
            details: valida.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
        });
    }
    try {
        const aluno = yield prisma.aluno.create({
            data: valida.data
        });
        res.status(201).json(aluno);
    }
    catch (error) {
        console.error('Erro no banco de dados:', error);
        res.status(400).json({
            error: "Erro ao criar aluno",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
// PUT atualizar aluno inteiro
router.put("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const valida = alunoSchema.safeParse(req.body);
    if (!valida.success) {
        return res.status(400).json({
            error: "Dados inválidos",
            details: valida.error.errors
        });
    }
    try {
        const exists = yield prisma.aluno.findUnique({
            where: { id: Number(req.params.id) }
        });
        if (!exists) {
            return res.status(404).json({ error: "Aluno não encontrado" });
        }
        const aluno = yield prisma.aluno.update({
            where: { id: Number(req.params.id) },
            data: valida.data
        });
        res.status(200).json(aluno);
    }
    catch (error) {
        console.error('Error updating student:', error);
        res.status(500).json({
            error: "Erro ao atualizar aluno",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
// PATCH atualizar parcialmente o aluno
router.patch("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const partialAlunoSchema = alunoSchema.partial();
    const valida = partialAlunoSchema.safeParse(req.body);
    if (!valida.success) {
        return res.status(400).json({
            error: "Dados inválidos",
            details: valida.error.errors
        });
    }
    try {
        const exists = yield prisma.aluno.findUnique({
            where: { id: Number(req.params.id) }
        });
        if (!exists) {
            return res.status(404).json({ error: "Aluno não encontrado" });
        }
        const aluno = yield prisma.aluno.update({
            where: { id: Number(req.params.id) },
            data: valida.data
        });
        res.status(200).json(aluno);
    }
    catch (error) {
        console.error('Error partially updating student:', error);
        res.status(500).json({
            error: "Erro ao atualizar aluno",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
// POST enviar email com empréstimos ativos (com rate limiting)
router.post("/:id/email", emailRateLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!mailConfig.auth.user || !mailConfig.auth.pass) {
            return res.status(500).json({
                error: 'Serviço de email não configurado',
                details: 'As credenciais de email não foram configuradas no servidor'
            });
        }
        const aluno = yield prisma.aluno.findUnique({
            where: { id: Number(req.params.id) },
            include: {
                emprestimos: {
                    where: { devolvido: false },
                    include: {
                        livro: { select: { id: true, titulo: true, autor: true, quantidade: true } }
                    },
                    orderBy: { dataDevolucao: 'asc' }
                }
            }
        });
        if (!aluno) {
            return res.status(404).json({ error: 'Aluno não encontrado' });
        }
        if (!aluno.email) {
            return res.status(400).json({ error: 'Aluno não possui email cadastrado' });
        }
        if (aluno.emprestimos.length === 0) {
            return res.json({
                message: 'Aluno não possui empréstimos ativos',
                alunoId: aluno.id
            });
        }
        const emailHtml = generateEmailHtml(aluno);
        const mailOptions = {
            from: process.env.MAILTRAP_FROM || `"Biblioteca" <${mailConfig.auth.user}>`,
            to: aluno.email,
            subject: `[Biblioteca] Empréstimos Ativos - ${aluno.nome}`,
            html: emailHtml,
            headers: {
                'X-Mailer': 'Node.js',
                'X-Priority': '3',
                'Importance': 'Normal'
            }
        };
        const info = yield transporter.sendMail(mailOptions);
        console.log('E-mail enviado:', info.messageId);
        res.json({
            success: true,
            message: `E-mail enviado para ${aluno.email}`,
            emprestimos: aluno.emprestimos.length,
            messageId: info.messageId
        });
    }
    catch (error) {
        console.error('Erro ao enviar e-mail:', error);
        let errorMessage = 'Falha ao enviar e-mail';
        let errorDetails = error instanceof Error ? error.message : String(error);
        if (error instanceof Error && 'code' in error) {
            switch (error.code) {
                case 'EAUTH':
                    errorMessage = 'Falha de autenticação no servidor de email';
                    break;
                case 'ECONNECTION':
                    errorMessage = 'Não foi possível conectar ao servidor de email';
                    break;
                case 'ETIMEDOUT':
                    errorMessage = 'Timeout ao conectar ao servidor de email';
                    break;
            }
        }
        res.status(500).json({
            error: errorMessage,
            details: errorDetails
        });
    }
}));
// Função auxiliar para gerar HTML do email
function generateEmailHtml(aluno) {
    return `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2 style="color: #2c3e50;">Histórico de Empréstimos Ativos</h2>
      <p>Aluno: <strong>${aluno.nome}</strong> (Matrícula: ${aluno.matricula})</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <thead>
          <tr style="background-color: #f8f9fa;">
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Livro</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Autor</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Empréstimo</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Devolução</th>
          </tr>
        </thead>
        <tbody>
          ${aluno.emprestimos.map((emp) => {
        var _a;
        const livro = (_a = emp.livro) !== null && _a !== void 0 ? _a : { titulo: 'Livro não encontrado', autor: 'N/A', quantidade: 0 };
        return `
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.titulo}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.autor}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${new Date(emp.dataEmprestimo).toLocaleDateString('pt-BR')}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">
                  ${emp.dataDevolucao ? new Date(emp.dataDevolucao).toLocaleDateString('pt-BR') : 'Pendente'}
                </td>
              </tr>
            `;
    }).join('')}
        </tbody>
      </table>
    </div>
  `;
}
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
