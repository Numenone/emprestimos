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
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const express_1 = require("express");
const zod_1 = require("zod");
const jwt_1 = require("../auth/jwt");
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
router.use(jwt_1.authenticateJWT);
const livroSchema = zod_1.z.object({
    titulo: zod_1.z.string().min(3, "Título deve ter pelo menos 3 caracteres"),
    autor: zod_1.z.string().min(3, "Autor deve ter pelo menos 3 caracteres"),
    quantidade: zod_1.z.number().int().positive("Quantidade deve ser um número inteiro positivo")
});
// GET todos os livros (não deletados)
router.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const livros = yield prisma.livro.findMany({
            where: { deleted: false },
            orderBy: { titulo: 'asc' }
        });
        // Registrar log de acesso
        yield prisma.log.create({
            data: {
                acao: 'LISTAGEM_LIVROS',
                detalhes: `Listagem de livros acessada por ${(_a = req.user) === null || _a === void 0 ? void 0 : _a.email}`,
                usuarioId: (_b = req.user) === null || _b === void 0 ? void 0 : _b.id
            }
        });
        res.json({ success: true, livros });
    }
    catch (error) {
        yield prisma.log.create({
            data: {
                acao: 'ERRO_LISTAGEM_LIVROS',
                detalhes: `Erro ao listar livros: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
                usuarioId: (_c = req.user) === null || _c === void 0 ? void 0 : _c.id
            }
        });
        res.status(500).json({ error: 'Erro ao buscar livros' });
    }
}));
// POST criar livro (apenas admin)
router.post("/", (0, jwt_1.checkPermission)(2), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const validation = livroSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            error: "Dados inválidos",
            details: validation.error.errors
        });
    }
    try {
        const livro = yield prisma.livro.create({
            data: validation.data
        });
        // Registrar log de criação
        yield prisma.log.create({
            data: {
                acao: 'CRIACAO_LIVRO',
                detalhes: `Livro criado: ${livro.titulo} (ID: ${livro.id})`,
                usuarioId: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id
            }
        });
        res.status(201).json({ success: true, livro });
    }
    catch (error) {
        yield prisma.log.create({
            data: {
                acao: 'ERRO_CRIACAO_LIVRO',
                detalhes: `Erro ao criar livro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
                usuarioId: (_b = req.user) === null || _b === void 0 ? void 0 : _b.id
            }
        });
        res.status(500).json({ error: 'Erro ao criar livro' });
    }
}));
// DELETE livro (soft delete, apenas admin)
router.delete("/:id", (0, jwt_1.checkPermission)(3), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const livro = yield prisma.livro.update({
            where: { id: Number(req.params.id) },
            data: {
                deleted: true,
                deletedAt: new Date()
            }
        });
        // Registrar log de exclusão
        yield prisma.log.create({
            data: {
                acao: 'EXCLUSAO_LIVRO',
                detalhes: `Livro marcado como excluído: ${livro.titulo} (ID: ${livro.id})`,
                usuarioId: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id
            }
        });
        res.json({
            success: true,
            message: 'Livro marcado como excluído com sucesso'
        });
    }
    catch (error) {
        yield prisma.log.create({
            data: {
                acao: 'ERRO_EXCLUSAO_LIVRO',
                detalhes: `Erro ao excluir livro ID ${req.params.id}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
                usuarioId: (_b = req.user) === null || _b === void 0 ? void 0 : _b.id
            }
        });
        res.status(500).json({ error: 'Erro ao excluir livro' });
    }
}));
// PUT atualizar livro completo
router.put("/:id", (0, jwt_1.checkPermission)(2), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "ID inválido" });
    }
    try {
        const quantidade = Number(req.body.quantidade);
        if (isNaN(quantidade) || quantidade <= 0) {
            return res.status(400).json({
                success: false,
                error: "Quantidade inválida: deve ser um número inteiro positivo"
            });
        }
        const livroData = {
            titulo: req.body.titulo,
            autor: req.body.autor,
            quantidade
        };
        const valida = livroSchema.safeParse(livroData);
        if (!valida.success) {
            return res.status(400).json({
                success: false,
                error: valida.error.errors.map(e => e.message).join(', ')
            });
        }
        const existeLivro = yield prisma.livro.findUnique({ where: { id } });
        if (!existeLivro) {
            return res.status(404).json({ success: false, error: "Livro não encontrado" });
        }
        const livro = yield prisma.livro.update({
            where: { id },
            data: valida.data
        });
        // Registrar log de atualização
        yield prisma.log.create({
            data: {
                acao: 'ATUALIZACAO_LIVRO',
                detalhes: `Livro atualizado: ${livro.titulo} (ID: ${livro.id})`,
                usuarioId: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id
            }
        });
        return res.status(200).json({ success: true, livro });
    }
    catch (error) {
        yield prisma.log.create({
            data: {
                acao: 'ERRO_ATUALIZACAO_LIVRO',
                detalhes: `Erro ao atualizar livro ID ${req.params.id}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
                usuarioId: (_b = req.user) === null || _b === void 0 ? void 0 : _b.id
            }
        });
        return res.status(500).json({
            success: false,
            error: "Erro ao atualizar livro",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
exports.default = router;
