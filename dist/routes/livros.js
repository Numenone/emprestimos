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
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
const livroSchema = zod_1.z.object({
    titulo: zod_1.z.string().min(3, "Título deve ter pelo menos 3 caracteres"),
    autor: zod_1.z.string().min(3, "Autor deve ter pelo menos 3 caracteres"),
    quantidade: zod_1.z.number().int().positive("Quantidade deve ser um número inteiro positivo")
});
// Função para converter e validar a quantidade
function parseQuantidade(q) {
    const n = typeof q === 'number' ? q : parseInt(q, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
}
// GET todos os livros (ordenados por título)
router.get("/", (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const livros = yield prisma.livro.findMany({
            orderBy: { titulo: 'asc' }
        });
        return res.status(200).json({ success: true, livros });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            error: "Erro ao buscar livros",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
// POST criar livro
router.post("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const quantidade = parseQuantidade(req.body.quantidade);
        if (quantidade === null) {
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
        const livro = yield prisma.livro.create({
            data: valida.data,
            select: {
                id: true,
                titulo: true,
                autor: true,
                quantidade: true,
                createdAt: true,
                updatedAt: true
            }
        });
        return res.status(201).json({ success: true, livro });
    }
    catch (error) {
        console.error('Erro ao criar livro:', error);
        return res.status(500).json({
            success: false,
            error: "Erro ao criar livro no banco de dados",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
// GET livro por ID
router.get("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "ID inválido" });
    }
    try {
        const livro = yield prisma.livro.findUnique({
            where: { id }
        });
        if (!livro) {
            return res.status(404).json({ success: false, error: "Livro não encontrado" });
        }
        return res.status(200).json({ success: true, livro });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            error: "Erro ao buscar livro",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
// PUT atualizar livro completo
router.put("/:id", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "ID inválido" });
    }
    try {
        const quantidade = parseQuantidade(req.body.quantidade);
        if (quantidade === null) {
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
        // Verifica se o livro existe antes de atualizar
        const existeLivro = yield prisma.livro.findUnique({ where: { id } });
        if (!existeLivro) {
            return res.status(404).json({ success: false, error: "Livro não encontrado" });
        }
        const livro = yield prisma.livro.update({
            where: { id },
            data: valida.data
        });
        return res.status(200).json({ success: true, livro });
    }
    catch (error) {
        console.error("Erro ao atualizar livro:", error);
        return res.status(500).json({
            success: false,
            error: "Erro ao atualizar livro",
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
exports.default = router;
