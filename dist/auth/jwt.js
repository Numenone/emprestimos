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
exports.decodeToken = exports.checkPermission = exports.authenticateJWT = exports.refreshToken = exports.generateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_please_change_in_production';
const generateToken = (userId, nivelAcesso) => {
    return jsonwebtoken_1.default.sign({ id: userId, nivel: nivelAcesso }, JWT_SECRET, {
        expiresIn: '1h'
    });
};
exports.generateToken = generateToken;
const refreshToken = (userId, nivelAcesso) => {
    return jsonwebtoken_1.default.sign({ id: userId, nivel: nivelAcesso }, JWT_SECRET, {
        expiresIn: '7d'
    });
};
exports.refreshToken = refreshToken;
const authenticateJWT = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const authHeader = req.headers['authorization'];
    const token = authHeader === null || authHeader === void 0 ? void 0 : authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token de acesso não fornecido' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        // Check if token is expired
        if (decoded.exp && Date.now() >= decoded.exp * 1000) {
            return res.status(401).json({ error: 'Token expirado' });
        }
        // First try to verify as student
        const aluno = yield prisma.aluno.findUnique({
            where: {
                id: decoded.id,
                deleted: false
            }
        });
        if (aluno) {
            if (aluno.bloqueado || aluno.status !== 'ATIVO') {
                return res.status(403).json({ error: 'Acesso negado. Conta inativa ou bloqueada.' });
            }
            req.aluno = aluno;
            return next();
        }
        // If not student, verify as user
        const usuario = yield prisma.usuario.findUnique({
            where: {
                id: decoded.id,
                deleted: false
            }
        });
        if (usuario) {
            if (usuario.bloqueado || usuario.status !== 'ATIVO') {
                return res.status(403).json({ error: 'Acesso negado. Conta inativa ou bloqueada.' });
            }
            req.user = usuario;
            return next();
        }
        return res.status(403).json({ error: 'Usuário não encontrado' });
    }
    catch (error) {
        console.error('JWT verification error:', error);
        return res.status(401).json({ error: 'Token inválido' });
    }
});
exports.authenticateJWT = authenticateJWT;
const checkPermission = (nivelRequerido) => {
    return (req, res, next) => {
        const user = req.user || req.aluno;
        if (!user || user.nivelAcesso < nivelRequerido) {
            return res.status(403).json({
                error: 'Acesso negado. Permissão insuficiente.',
                requiredLevel: nivelRequerido,
                currentLevel: user === null || user === void 0 ? void 0 : user.nivelAcesso
            });
        }
        next();
    };
};
exports.checkPermission = checkPermission;
const decodeToken = (token) => {
    try {
        return jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch (error) {
        return null;
    }
};
exports.decodeToken = decodeToken;
