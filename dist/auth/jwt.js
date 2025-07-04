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
exports.checkPermission = exports.refreshToken = exports.generateToken = exports.authenticateJWT = exports.csrfProtection = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const axios_1 = __importDefault(require("axios"));
const client_1 = require("@prisma/client");
const csurf_1 = __importDefault(require("csurf"));
const prisma = new client_1.PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_please_change_in_production';
const API_URL = process.env.API_URL || 'http://localhost:3000';
exports.csrfProtection = (0, csurf_1.default)({
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
    }
});
const authenticateJWT = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).redirect('/?error=Acesso não autorizado');
    }
    try {
        // Verificar token com a API
        const response = yield axios_1.default.get(`${API_URL}/usuarios/perfil`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        req.user = response.data;
        next();
    }
    catch (error) {
        // Token inválido ou expirado - tentar renovar com refresh token
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) {
            res.clearCookie('token');
            return res.status(401).redirect('/?error=Sessão expirada');
        }
        try {
            const refreshResponse = yield axios_1.default.post(`${API_URL}/usuarios/refresh-token`, {
                refreshToken
            });
            // Atualizar cookies
            res.cookie('token', refreshResponse.data.token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 3600000,
                sameSite: 'strict'
            });
            res.cookie('refreshToken', refreshResponse.data.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 604800000,
                sameSite: 'strict'
            });
            // Obter dados do usuário com o novo token
            const userResponse = yield axios_1.default.get(`${API_URL}/usuarios/perfil`, {
                headers: { 'Authorization': `Bearer ${refreshResponse.data.token}` }
            });
            req.user = userResponse.data;
            next();
        }
        catch (refreshError) {
            // Refresh token inválido - limpar cookies e redirecionar para login
            res.clearCookie('token');
            res.clearCookie('refreshToken');
            return res.status(401).redirect('/?error=Sessão expirada');
        }
    }
});
exports.authenticateJWT = authenticateJWT;
const generateToken = (userId, nivelAcesso) => {
    return jsonwebtoken_1.default.sign({ id: userId, nivelAcesso }, JWT_SECRET, { expiresIn: '1h' });
};
exports.generateToken = generateToken;
const refreshToken = (userId, nivelAcesso) => {
    return jsonwebtoken_1.default.sign({ id: userId, nivelAcesso }, JWT_SECRET, { expiresIn: '7d' });
};
exports.refreshToken = refreshToken;
const checkPermission = (nivelRequerido) => {
    return (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        if (!req.user || req.user.nivelAcesso < nivelRequerido) {
            return res.status(403).render('error', {
                message: 'Acesso negado. Permissão insuficiente.',
                csrfToken: ((_a = req.csrfToken) === null || _a === void 0 ? void 0 : _a.call(req)) || ''
            });
        }
        next();
    });
};
exports.checkPermission = checkPermission;
