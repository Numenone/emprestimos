import { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const prisma = new PrismaClient();
const router = Router();
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
  port: parseInt(process.env.MAILTRAP_PORT || "2525"),
  auth: {
    user: process.env.MAILTRAP_USER || '',
    pass: process.env.MAILTRAP_PASS || ''
  }
});

// Validação com Zod
const usuarioSchema = z.object({
  nome: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  email: z.string().email("Email inválido"),
  senha: z.string()
    .min(8, "Senha deve ter pelo menos 8 caracteres")
    .regex(/[A-Z]/, "Senha deve conter pelo menos uma letra maiúscula")
    .regex(/[a-z]/, "Senha deve conter pelo menos uma letra minúscula")
    .regex(/[0-9]/, "Senha deve conter pelo menos um número")
    .regex(/[^A-Za-z0-9]/, "Senha deve conter pelo menos um símbolo")
});

// Middleware de autenticação
export const authenticateToken = (req: any, res: Response, next: Function) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso não fornecido' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
    req.user = user;
    next();
  });
};

// POST criar usuário
router.post("/", async (req: Request, res: Response) => {
  const valida = usuarioSchema.safeParse(req.body);
  
  if (!valida.success) {
    return res.status(400).json({ 
      error: "Dados inválidos",
      details: valida.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
    });
  }

  try {
    const { nome, email, senha } = valida.data;
    const hashedPassword = await bcrypt.hash(senha, SALT_ROUNDS);
    const codigoAtivacao = Math.random().toString(36).substring(2, 6).toUpperCase();

    const usuario = await prisma.usuario.create({ 
      data: { 
        nome, 
        email, 
        senha: hashedPassword,
        codigoAtivacao
      } 
    });

    // Enviar email de ativação
    const mailOptions = {
      from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
      to: email,
      subject: 'Ativação de conta',
      html: `
        <p>Olá ${nome},</p>
        <p>Seu código de ativação é: <strong>${codigoAtivacao}</strong></p>
        <p>Use este código para ativar sua conta.</p>
      `
    };

    await transporter.sendMail(mailOptions);

    // Registrar log
    await prisma.log.create({
      data: {
        acao: 'CADASTRO_USUARIO',
        detalhes: `Novo usuário cadastrado: ${email}`,
        usuarioId: usuario.id
      }
    });

    res.status(201).json({ 
      success: true,
      message: 'Usuário criado com sucesso. Verifique seu email para ativar a conta.'
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// POST ativar usuário
router.post("/ativar", async (req: Request, res: Response) => {
  const { email, codigo } = req.body;
  
  if (!email || !codigo) {
    return res.status(400).json({ error: 'Email e código são obrigatórios' });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    
    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (usuario.status === 'ATIVO') {
      return res.status(400).json({ error: 'Usuário já está ativo' });
    }

    if (usuario.codigoAtivacao !== codigo) {
      return res.status(400).json({ error: 'Código de ativação inválido' });
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { 
        status: 'ATIVO',
        codigoAtivacao: null 
      }
    });

    // Registrar log
    await prisma.log.create({
      data: {
        acao: 'ATIVACAO_USUARIO',
        detalhes: `Usuário ativado: ${email}`,
        usuarioId: usuario.id
      }
    });

    res.json({ success: true, message: 'Conta ativada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao ativar usuário' });
  }
});

// POST login
router.post("/login", async (req: Request, res: Response) => {
  const { email, senha } = req.body;
  
  if (!email || !senha) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    
    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (usuario.bloqueado) {
      return res.status(403).json({ error: 'Conta bloqueada. Entre em contato com o administrador.' });
    }

    if (usuario.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Conta não ativada. Verifique seu email.' });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    
    if (!senhaValida) {
      // Incrementar tentativas de login
      const tentativas = usuario.tentativasLogin + 1;
      const bloqueado = tentativas >= 3;
      
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { 
          tentativasLogin: tentativas,
          bloqueado
        }
      });

      // Registrar log de tentativa falha
      await prisma.log.create({
        data: {
          acao: 'TENTATIVA_LOGIN_FALHA',
          detalhes: `Tentativa ${tentativas} de login falhou para ${email}`,
          usuarioId: usuario.id
        }
      });

      return res.status(401).json({ 
        error: 'Credenciais inválidas',
        tentativasRestantes: 3 - tentativas
      });
    }

    // Resetar tentativas de login
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { 
        tentativasLogin: 0,
        ultimoLogin: new Date()
      }
    });

    // Registrar log de login bem-sucedido
    await prisma.log.create({
      data: {
        acao: 'LOGIN',
        detalhes: `Login bem-sucedido para ${email}`,
        usuarioId: usuario.id
      }
    });

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, nivel: usuario.nivelAcesso },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ 
      success: true,
      token,
      ultimoLogin: usuario.ultimoLogin 
        ? `Seu último acesso foi em ${usuario.ultimoLogin.toLocaleString()}` 
        : 'Este é seu primeiro acesso'
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao realizar login' });
  }
});

// POST recuperar senha
router.post("/recuperar-senha", async (req: Request, res: Response) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email é obrigatório' });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    
    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const codigoRecuperacao = Math.random().toString(36).substring(2, 6).toUpperCase();

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { codigoAtivacao: codigoRecuperacao }
    });

    // Enviar email com código de recuperação
    const mailOptions = {
      from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
      to: email,
      subject: 'Recuperação de senha',
      html: `
        <p>Olá ${usuario.nome},</p>
        <p>Seu código de recuperação é: <strong>${codigoRecuperacao}</strong></p>
        <p>Use este código para redefinir sua senha.</p>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: 'Código de recuperação enviado para seu email' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao processar recuperação de senha' });
  }
});

// POST redefinir senha
router.post("/redefinir-senha", async (req: Request, res: Response) => {
  const { email, codigo, novaSenha } = req.body;
  
  if (!email || !codigo || !novaSenha) {
    return res.status(400).json({ error: 'Email, código e nova senha são obrigatórios' });
  }

  try {
    const valida = usuarioSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
    if (!valida.success) {
      return res.status(400).json({ 
        error: "Senha inválida",
        details: valida.error.errors.map(e => e.message).join(', ')
      });
    }

    const usuario = await prisma.usuario.findUnique({ where: { email } });
    
    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (usuario.codigoAtivacao !== codigo) {
      return res.status(400).json({ error: 'Código de recuperação inválido' });
    }

    const hashedPassword = await bcrypt.hash(novaSenha, SALT_ROUNDS);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { 
        senha: hashedPassword,
        codigoAtivacao: null
      }
    });

    // Registrar log
    await prisma.log.create({
      data: {
        acao: 'REDEFINICAO_SENHA',
        detalhes: `Senha redefinida para ${email}`,
        usuarioId: usuario.id
      }
    });

    res.json({ success: true, message: 'Senha redefinida com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

// GET logs (protegido, apenas admin)
router.get("/logs", authenticateToken, async (req: any, res: Response) => {
  if (req.user.nivel < 3) {
    return res.status(403).json({ error: 'Acesso negado. Nível de acesso insuficiente.' });
  }

  try {
    const logs = await prisma.log.findMany({
      orderBy: { createdAt: 'desc' },
      include: { usuario: { select: { nome: true, email: true } } }
    });
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

export { router as usuariosRouter, authenticateToken };