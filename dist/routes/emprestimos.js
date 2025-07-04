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
const jwt_1 = require("../auth/jwt");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
const transporter = nodemailer_1.default.createTransport({
    host: process.env.MAIL_HOST || 'smtp.example.com',
    port: parseInt(process.env.MAIL_PORT || '587'),
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    }
});
// Rate limiting for email sending
const emailRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: 'Too many email requests, please try again later'
});
// Schemas for validation
const emprestimoCreateSchema = zod_1.z.object({
    alunoId: zod_1.z.number().int().positive(),
    livroId: zod_1.z.number().int().positive(),
    dataDevolucao: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});
const emprestimoUpdateSchema = zod_1.z.object({
    alunoId: zod_1.z.number().int().positive().optional(),
    livroId: zod_1.z.number().int().positive().optional(),
    dataDevolucao: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});
router.use(jwt_1.authenticateJWT);
// Error handling utility
function handleError(res, error, action) {
    console.error(`Error while trying to ${action}:`, error);
    if (error instanceof Error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            action
        });
    }
    res.status(500).json({
        success: false,
        error: 'An unexpected error occurred',
        action
    });
}
// POST criar empréstimo
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const validation = emprestimoCreateSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            error: "Dados inválidos",
            details: validation.error.errors
        });
    }
    try {
        const { alunoId, livroId, dataDevolucao } = validation.data;
        const devolutionDate = new Date(dataDevolucao);
        // Validate devolution date is in the future
        if (devolutionDate <= new Date()) {
            return res.status(400).json({
                success: false,
                error: "Data de devolução deve ser no futuro"
            });
        }
        // Verify student exists and is active
        const aluno = yield prisma.aluno.findUnique({
            where: {
                id: alunoId,
                deleted: false,
                status: 'ATIVO',
                bloqueado: false
            },
            include: {
                emprestimos: {
                    where: { devolvido: false },
                    select: { id: true }
                }
            }
        });
        if (!aluno) {
            return res.status(404).json({
                success: false,
                error: 'Aluno não encontrado ou inativo'
            });
        }
        // Check if student has too many active loans (max 3)
        if (aluno.emprestimos.length >= 3) {
            return res.status(400).json({
                success: false,
                error: 'Aluno atingiu o limite máximo de empréstimos ativos (3)'
            });
        }
        // Verify book exists and is available
        const livro = yield prisma.livro.findUnique({
            where: {
                id: livroId,
                deleted: false
            }
        });
        if (!livro) {
            return res.status(404).json({
                success: false,
                error: 'Livro não encontrado'
            });
        }
        if (livro.quantidade <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Livro não disponível (quantidade esgotada)'
            });
        }
        // Create loan and update book quantity in a transaction
        const [emprestimo] = yield prisma.$transaction([
            prisma.emprestimo.create({
                data: {
                    alunoId,
                    livroId,
                    dataEmprestimo: new Date(),
                    dataDevolucao: devolutionDate,
                    devolvido: false
                },
                include: {
                    aluno: { select: { nome: true } },
                    livro: { select: { titulo: true } }
                }
            }),
            prisma.livro.update({
                where: { id: livroId },
                data: { quantidade: { decrement: 1 } }
            }),
            // Log the loan creation
            prisma.log.create({
                data: {
                    acao: 'CRIACAO_EMPRESTIMO',
                    detalhes: `Empréstimo criado para aluno ${alunoId} (livro ${livroId})`,
                    alunoId: alunoId
                }
            })
        ]);
        res.status(201).json({
            success: true,
            data: emprestimo,
            message: 'Empréstimo registrado com sucesso'
        });
    }
    catch (error) {
        handleError(res, error, "criar empréstimo");
    }
}));
// GET - List active loans with pagination and filters
router.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 10, 100);
    const skip = (page - 1) * pageSize;
    const { alunoId, livroId, atrasados } = req.query;
    try {
        const whereClause = { devolvido: false };
        if (alunoId)
            whereClause.alunoId = parseInt(alunoId);
        if (livroId)
            whereClause.livroId = parseInt(livroId);
        if (atrasados === 'true') {
            whereClause.dataDevolucao = { lt: new Date() };
        }
        const [emprestimos, total] = yield Promise.all([
            prisma.emprestimo.findMany({
                where: whereClause,
                include: {
                    aluno: { select: { nome: true, email: true, matricula: true } },
                    livro: { select: { titulo: true, autor: true } }
                },
                orderBy: { dataEmprestimo: 'desc' },
                skip,
                take: pageSize
            }),
            prisma.emprestimo.count({ where: whereClause })
        ]);
        // Calculate overdue status for each loan
        const emprestimosComStatus = emprestimos.map(emp => (Object.assign(Object.assign({}, emp), { atrasado: emp.dataDevolucao < new Date() && !emp.devolvido })));
        res.status(200).json({
            success: true,
            data: emprestimosComStatus,
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
            include: {
                livro: true,
                aluno: { select: { id: true } }
            }
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
                    dataDevolucao: new Date()
                }
            }),
            prisma.livro.update({
                where: { id: emprestimo.livroId },
                data: { quantidade: { increment: 1 } }
            }),
            // Log the return
            prisma.log.create({
                data: {
                    acao: 'DEVOLUCAO_LIVRO',
                    detalhes: `Livro ${emprestimo.livroId} devolvido pelo aluno ${emprestimo.alunoId}`,
                    alunoId: emprestimo.alunoId
                }
            })
        ]);
        res.json({
            success: true,
            data: {
                livro: {
                    id: livroAtualizado.id,
                    titulo: livroAtualizado.titulo,
                    quantidade: livroAtualizado.quantidade
                }
            },
            message: "Devolução registrada com sucesso"
        });
    }
    catch (error) {
        handleError(res, error, "registrar devolução");
    }
}));
// PUT - Full update loan (admin only)
router.put("/:id", (0, jwt_1.checkPermission)(2), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const validation = emprestimoCreateSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            error: validation.error.errors.map(e => e.message).join(', ')
        });
    }
    try {
        // Verify loan exists
        const existingLoan = yield prisma.emprestimo.findUnique({
            where: { id: Number(req.params.id) }
        });
        if (!existingLoan) {
            return res.status(404).json({
                success: false,
                error: "Empréstimo não encontrado"
            });
        }
        const { alunoId, livroId, dataDevolucao } = validation.data;
        const devolutionDate = new Date(dataDevolucao);
        // Verify student exists
        const alunoExists = yield prisma.aluno.count({
            where: { id: alunoId, deleted: false }
        });
        if (!alunoExists) {
            return res.status(404).json({
                success: false,
                error: "Aluno não encontrado"
            });
        }
        // Verify book exists
        const livroExists = yield prisma.livro.count({
            where: { id: livroId, deleted: false }
        });
        if (!livroExists) {
            return res.status(404).json({
                success: false,
                error: "Livro não encontrado"
            });
        }
        const emprestimo = yield prisma.emprestimo.update({
            where: { id: Number(req.params.id) },
            data: {
                alunoId,
                livroId,
                dataDevolucao: devolutionDate
            },
            include: {
                aluno: { select: { nome: true } },
                livro: { select: { titulo: true } }
            }
        });
        res.status(200).json({
            success: true,
            data: emprestimo,
            message: "Empréstimo atualizado com sucesso"
        });
    }
    catch (error) {
        handleError(res, error, "atualizar empréstimo");
    }
}));
// PATCH - Partial update loan (admin only)
router.patch("/:id", (0, jwt_1.checkPermission)(2), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const validation = emprestimoUpdateSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            error: validation.error.errors.map(e => e.message).join(', ')
        });
    }
    try {
        // Verify loan exists
        const existingLoan = yield prisma.emprestimo.findUnique({
            where: { id: Number(req.params.id) }
        });
        if (!existingLoan) {
            return res.status(404).json({
                success: false,
                error: "Empréstimo não encontrado"
            });
        }
        const updateData = {};
        if (validation.data.alunoId !== undefined) {
            // Verify student exists
            const alunoExists = yield prisma.aluno.count({
                where: { id: validation.data.alunoId, deleted: false }
            });
            if (!alunoExists) {
                return res.status(404).json({
                    success: false,
                    error: "Aluno não encontrado"
                });
            }
            updateData.alunoId = validation.data.alunoId;
        }
        if (validation.data.livroId !== undefined) {
            // Verify book exists
            const livroExists = yield prisma.livro.count({
                where: { id: validation.data.livroId, deleted: false }
            });
            if (!livroExists) {
                return res.status(404).json({
                    success: false,
                    error: "Livro não encontrado"
                });
            }
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
        res.status(200).json({
            success: true,
            data: emprestimo,
            message: "Empréstimo atualizado com sucesso"
        });
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
                        livro: {
                            select: {
                                id: true,
                                titulo: true,
                                autor: true
                            }
                        }
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
        // Log the email sending
        yield prisma.log.create({
            data: {
                acao: 'EMAIL_EMPRESTIMOS',
                detalhes: `E-mail enviado para ${aluno.email} com ${aluno.emprestimos.length} empréstimos ativos`,
                alunoId: aluno.id
            }
        });
        res.json({
            success: true,
            data: {
                destinatario: aluno.email,
                totalEmprestimos: aluno.emprestimos.length,
                messageId: info.messageId
            },
            message: 'E-mail enviado com sucesso'
        });
    }
    catch (error) {
        handleError(res, error, "enviar e-mail");
    }
}));
// Helper function to generate email HTML
function generateEmailHtml(aluno) {
    const currentDate = new Date().toLocaleDateString('pt-BR');
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #2c3e50;">Biblioteca Digital</h1>
        <p style="color: #7f8c8d;">${currentDate}</p>
      </div>
      
      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #2c3e50; margin-top: 0;">Olá, ${aluno.nome}!</h2>
        <p>Este é o resumo dos seus empréstimos ativos na biblioteca.</p>
      </div>
      
      ${aluno.emprestimos.length > 0 ? `
        <h3 style="color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 10px;">
          Empréstimos Ativos (${aluno.emprestimos.length})
        </h3>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #5c43e7; color: white;">
              <th style="padding: 10px; text-align: left;">Livro</th>
              <th style="padding: 10px; text-align: left;">Autor</th>
              <th style="padding: 10px; text-align: left;">Devolução</th>
              <th style="padding: 10px; text-align: left;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${aluno.emprestimos.map((emp) => {
        var _a, _b;
        const isOverdue = emp.dataDevolucao < new Date();
        return `
                <tr style="${isOverdue ? 'background-color: #fff3bf;' : ''}">
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${((_a = emp.livro) === null || _a === void 0 ? void 0 : _a.titulo) || 'Livro não encontrado'}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${((_b = emp.livro) === null || _b === void 0 ? void 0 : _b.autor) || 'N/A'}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${emp.dataDevolucao.toLocaleDateString('pt-BR')}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">
                    ${isOverdue ?
            '<span style="color: #c92a2a; font-weight: bold;">ATRASADO</span>' :
            '<span style="color: #2b8a3e;">EM DIA</span>'}
                  </td>
                </tr>
              `;
    }).join('')}
          </tbody>
        </table>
        
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <p style="margin: 0;">Por favor, verifique as datas de devolução para evitar multas por atraso.</p>
        </div>
      ` : `
        <div style="text-align: center; padding: 20px; background-color: #f8f9fa; border-radius: 5px;">
          <p style="font-size: 1.1em;">Você não possui empréstimos ativos no momento.</p>
        </div>
      `}
      
      <div style="text-align: center; margin-top: 30px; color: #7f8c8d; font-size: 0.9em;">
        <p>Esta é uma mensagem automática. Por favor, não responda este e-mail.</p>
        <p>© ${new Date().getFullYear()} Biblioteca Digital. Todos os direitos reservados.</p>
      </div>
    </div>
  `;
}
// Graceful shutdown
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    process.exit(0);
}));
exports.default = router;
