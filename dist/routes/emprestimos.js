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
// Rate limiting for email endpoint
const emailRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: 'Too many email requests from this IP, please try again later'
});
// Email transporter configuration
const transporter = nodemailer_1.default.createTransport({
    host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
    port: parseInt(process.env.MAILTRAP_PORT || "2525"),
    auth: {
        user: process.env.MAILTRAP_USER || '',
        pass: process.env.MAILTRAP_PASS || ''
    }
});
// Validation schemas
const EmprestimoSchema = {
    create: zod_1.z.object({
        alunoId: zod_1.z.number().int().positive("ID do aluno inválido"),
        livroId: zod_1.z.number().int().positive("ID do livro inválido"),
        dataDevolucao: zod_1.z.string().refine(date => {
            return !isNaN(Date.parse(date));
        }, {
            message: "Data de devolução inválida (use formato YYYY-MM-DD)"
        })
    }),
    update: zod_1.z.object({
        alunoId: zod_1.z.number().int().positive("ID do aluno inválido").optional(),
        livroId: zod_1.z.number().int().positive("ID do livro inválido").optional(),
        dataDevolucao: zod_1.z.string().datetime({ offset: true }).optional()
    })
};
// Error handling helper
const handleError = (res, error, context) => {
    console.error(`Erro em ${context}:`, error);
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    res.status(500).json({
        success: false,
        error: `Erro ao ${context}`,
        details: message
    });
};
// POST - Create loan
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const validation = EmprestimoSchema.create.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            error: validation.error.errors.map(e => e.message).join(', ')
        });
    }
    try {
        const { alunoId, livroId, dataDevolucao } = validation.data;
        const dataDevolucaoObj = new Date(dataDevolucao);
        // Verify book availability
        const livro = yield prisma.livro.findUnique({ where: { id: livroId } });
        if (!livro || livro.quantidade <= 0) {
            return res.status(400).json({
                success: false,
                error: "Livro não disponível"
            });
        }
        // Verify student exists
        const alunoExists = yield prisma.aluno.findUnique({ where: { id: alunoId } });
        if (!alunoExists) {
            return res.status(400).json({
                success: false,
                error: "Aluno não encontrado"
            });
        }
        // Transaction
        const [novoEmprestimo] = yield prisma.$transaction([
            prisma.emprestimo.create({
                data: {
                    alunoId,
                    livroId,
                    dataEmprestimo: new Date(),
                    dataDevolucao: dataDevolucaoObj,
                    devolvido: false,
                },
                include: {
                    aluno: { select: { nome: true, email: true } },
                    livro: { select: { titulo: true, autor: true } }
                }
            }),
            prisma.livro.update({
                where: { id: livroId },
                data: { quantidade: { decrement: 1 } }
            })
        ]);
        res.status(201).json({
            success: true,
            emprestimo: novoEmprestimo
        });
    }
    catch (error) {
        handleError(res, error, "criar empréstimo");
    }
}));
// GET - List active loans with pagination
router.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const skip = (page - 1) * pageSize;
    try {
        const [emprestimos, total] = yield Promise.all([
            prisma.emprestimo.findMany({
                where: { devolvido: false },
                include: {
                    aluno: { select: { nome: true, email: true } },
                    livro: { select: { titulo: true, autor: true } }
                },
                orderBy: { dataEmprestimo: 'desc' },
                skip,
                take: pageSize
            }),
            prisma.emprestimo.count({ where: { devolvido: false } })
        ]);
        res.status(200).json({
            data: emprestimos,
            pagination: {
                page,
                pageSize,
                totalItems: total,
                totalPages: Math.ceil(total / pageSize)
            }
        });
    }
    catch (error) {
        handleError(res, error, "listar empréstimos");
    }
}));
// DELETE - Return book
router.delete("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const emprestimo = yield prisma.emprestimo.findUnique({
            where: { id: Number(req.params.id) },
            include: { livro: true }
        });
        if (!emprestimo) {
            return res.status(404).json({
                success: false,
                error: "Empréstimo não encontrado"
            });
        }
        if (emprestimo.devolvido) {
            return res.status(400).json({
                success: false,
                error: "Livro já devolvido"
            });
        }
        const [_, livroAtualizado] = yield prisma.$transaction([
            prisma.emprestimo.update({
                where: { id: Number(req.params.id) },
                data: {
                    devolvido: true,
                    dataDevolucao: new Date() // Set return date to now
                }
            }),
            prisma.livro.update({
                where: { id: emprestimo.livroId },
                data: { quantidade: { increment: 1 } }
            })
        ]);
        res.json({
            success: true,
            message: "Devolução registrada com sucesso",
            livro: {
                id: livroAtualizado.id,
                titulo: livroAtualizado.titulo,
                quantidade: livroAtualizado.quantidade
            }
        });
    }
    catch (error) {
        handleError(res, error, "registrar devolução");
    }
}));
// PUT - Full update loan
router.put("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const validation = EmprestimoSchema.create.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            error: validation.error.errors.map(e => e.message).join(', ')
        });
    }
    try {
        // Verify loan exists
        const exists = yield prisma.emprestimo.findUnique({
            where: { id: Number(req.params.id) }
        });
        if (!exists) {
            return res.status(404).json({
                success: false,
                error: "Empréstimo não encontrado"
            });
        }
        const emprestimo = yield prisma.emprestimo.update({
            where: { id: Number(req.params.id) },
            data: {
                alunoId: validation.data.alunoId,
                livroId: validation.data.livroId,
                dataDevolucao: new Date(validation.data.dataDevolucao)
            },
            include: {
                aluno: { select: { nome: true } },
                livro: { select: { titulo: true } }
            }
        });
        res.status(200).json({ success: true, emprestimo });
    }
    catch (error) {
        handleError(res, error, "atualizar empréstimo");
    }
}));
// PATCH - Partial update loan
router.patch("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const validation = EmprestimoSchema.update.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            error: validation.error.errors.map(e => e.message).join(', ')
        });
    }
    try {
        // Verify loan exists
        const exists = yield prisma.emprestimo.findUnique({
            where: { id: Number(req.params.id) }
        });
        if (!exists) {
            return res.status(404).json({
                success: false,
                error: "Empréstimo não encontrado"
            });
        }
        const updateData = {};
        if (validation.data.alunoId !== undefined) {
            updateData.alunoId = validation.data.alunoId;
        }
        if (validation.data.livroId !== undefined) {
            updateData.livroId = validation.data.livroId;
        }
        if (validation.data.dataDevolucao !== undefined) {
            updateData.dataDevolucao = new Date(validation.data.dataDevolucao);
        }
        const emprestimo = yield prisma.emprestimo.update({
            where: { id: Number(req.params.id) },
            data: updateData,
            include: {
                aluno: { select: { nome: true } },
                livro: { select: { titulo: true } }
            }
        });
        res.status(200).json({ success: true, emprestimo });
    }
    catch (error) {
        handleError(res, error, "atualizar empréstimo");
    }
}));
// POST - Send email with active loans (with rate limiting)
router.post('/:id/email', emailRateLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const aluno = yield prisma.aluno.findUnique({
            where: { id: Number(req.params.id) },
            include: {
                emprestimos: {
                    where: { devolvido: false },
                    include: {
                        // Incluindo todos os campos necessários para o tipo Livro
                        livro: { select: { id: true, titulo: true, autor: true, quantidade: true } }
                    },
                    orderBy: { dataDevolucao: 'asc' }
                }
            }
        });
        if (!aluno) {
            return res.status(404).json({
                success: false,
                error: "Aluno não encontrado"
            });
        }
        const html = generateEmailHtml(aluno);
        const info = yield transporter.sendMail({
            from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
            to: aluno.email,
            subject: `Seus empréstimos ativos - ${aluno.nome}`,
            html
        });
        console.log('Email sent:', info.messageId);
        res.json({
            success: true,
            message: 'E-mail enviado com sucesso',
            destinatario: aluno.email,
            totalEmprestimos: aluno.emprestimos.length
        });
    }
    catch (error) {
        handleError(res, error, "enviar e-mail");
    }
}));
// Helper function to generate email HTML
function generateEmailHtml(aluno) {
    return `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2 style="color: #2c3e50;">Histórico de Empréstimos Ativos</h2>
      <p>Aluno: <strong>${aluno.nome}</strong> (${aluno.email})</p>
      ${aluno.emprestimos.length > 0 ? `
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Livro</th>
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Autor</th>
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Data Empréstimo</th>
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Data Devolução</th>
            </tr>
          </thead>
          <tbody>
            ${aluno.emprestimos.map(emp => {
        var _a, _b;
        return `
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">${((_a = emp.livro) === null || _a === void 0 ? void 0 : _a.titulo) || 'Livro não encontrado'}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${((_b = emp.livro) === null || _b === void 0 ? void 0 : _b.autor) || 'N/A'}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${emp.dataEmprestimo.toLocaleDateString('pt-BR')}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">
                  ${emp.dataDevolucao ? emp.dataDevolucao.toLocaleDateString('pt-BR') : 'Pendente'}
                </td>
              </tr>
            `;
    }).join('')}
          </tbody>
        </table>
      ` : '<p style="margin-top: 15px;">Nenhum empréstimo ativo no momento.</p>'}
      <p style="margin-top: 20px; font-size: 0.9em; color: #666;">
        Esta é uma mensagem automática, por favor não responda.
      </p>
    </div>
  `;
}
// Proper shutdown handling
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
exports.default = router;
