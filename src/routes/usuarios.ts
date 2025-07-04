import { PrismaClient } from '@prisma/client';
import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest } from '../types/express';
import { authenticateJWT, checkPermission as jwtCheckPermission } from '../auth/jwt';

const router = Router();
const SALT_ROUNDS = 10;

// Prisma client instance
const prisma = new PrismaClient();

// Middleware para checar permissão de acesso
function checkPermission(nivelMinimo: number) {
  return (req: AuthenticatedRequest, res: Response, next: Function) => {
    if (req.user && req.user.nivelAcesso >= nivelMinimo) {
      return next();
    }
    return res.status(403).json({ success: false, error: 'Permissão insuficiente' });
  };
}

const REFRESH_SECRET = process.env.REFRESH_SECRET || 'your_refresh_secret_here';
// const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '1h';
// const REFRESH_EXPIRY = process.env.REFRESH_EXPIRY || '7d';

// Rate limiting for authentication endpoints
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many attempts, please try again later'
});

// Email transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp.example.com',
  port: parseInt(process.env.MAIL_PORT || '587'),
  secure: process.env.MAIL_SECURE === 'true',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  },
  tls: {
    rejectUnauthorized: false // For self-signed certificates
  }
});

// Zod validation schemas
const usuarioSchema = z.object({
  nome: z.string()
    .min(3, "Nome deve ter pelo menos 3 caracteres")
    .max(100, "Nome deve ter no máximo 100 caracteres"),
  email: z.string()
    .email("Email inválido")
    .max(100, "Email deve ter no máximo 100 caracteres"),
  senha: z.string()
    .min(8, "Senha deve ter pelo menos 8 caracteres")
    .max(100, "Senha deve ter no máximo 100 caracteres")
    .regex(/[A-Z]/, "Senha deve conter pelo menos uma letra maiúscula")
    .regex(/[a-z]/, "Senha deve conter pelo menos uma letra minúscula")
    .regex(/[0-9]/, "Senha deve conter pelo menos um número")
    .regex(/[^A-Za-z0-9]/, "Senha deve conter pelo menos um símbolo"),
  perguntaSeguranca: z.string()
    .min(5, "Pergunta deve ter pelo menos 5 caracteres")
    .max(200, "Pergunta deve ter no máximo 200 caracteres")
    .optional(),
  respostaSeguranca: z.string()
    .min(2, "Resposta deve ter pelo menos 2 caracteres")
    .max(100, "Resposta deve ter no máximo 100 caracteres")
    .optional()
});

const activateAccountSchema = z.object({
  email: z.string().email(),
  codigo: z.string().length(4, "Código deve ter 4 caracteres")
});

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(8)
});

const passwordResetSchema = z.object({
  email: z.string().email(),
  codigo: z.string().length(4, "Código deve ter 4 caracteres").optional(),
  resposta: z.string().min(2).optional(),
  novaSenha: z.string().min(8)
}).superRefine((data, ctx) => {
  if (!data.codigo && !data.resposta) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Código ou resposta de segurança é obrigatório"
    });
  }
});

// Utility functions
export const generateToken = (userId: number, nivelAcesso: number): string => {
  return jwt.sign(
    { id: userId, nivel: nivelAcesso },
    process.env.JWT_SECRET || 'your_secret_key',
    { expiresIn: '1h' }
  );
};

export const refreshToken = (userId: number, nivelAcesso: number): string => {
  return jwt.sign(
    { id: userId, nivel: nivelAcesso },
    process.env.REFRESH_SECRET || 'your_refresh_secret', 
    { expiresIn: '7d' }
  );
};

async function sendActivationEmail(email: string, nome: string, codigo: string) {
  const mailOptions = {
    from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
    to: email,
    subject: 'Ativação de conta',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50;">Olá ${nome},</h2>
        <p>Seu código de ativação é: <strong style="font-size: 1.2em;">${codigo}</strong></p>
        <p>Use este código para ativar sua conta em nossa plataforma.</p>
        <p>Ou clique no link abaixo:</p>
        <div style="margin: 20px 0;">
          <a href="${process.env.APP_URL}/ativar-conta?email=${encodeURIComponent(email)}&codigo=${codigo}" 
             style="display: inline-block; padding: 10px 20px; background-color: #5c43e7; color: white; text-decoration: none; border-radius: 4px;">
            Ativar minha conta
          </a>
        </div>
        <p style="font-size: 0.9em; color: #7f8c8d;">
          Se você não solicitou este e-mail, por favor ignore esta mensagem.
        </p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

async function logAction(acao: string, detalhes: string, usuarioId?: number) {
  await prisma.log.create({
    data: {
      acao,
      detalhes,
      usuarioId
    }
  });
}

// Error handling middleware
function handleError(res: Response, error: unknown, action: string) {
  console.error(`Error during ${action}:`, error);
  
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: error.errors
    });
  }
  
  if (error instanceof Error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
  
  res.status(500).json({
    success: false,
    error: "An unexpected error occurred"
  });
}

// Routes
router.post("/", authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = usuarioSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        details: validation.error.errors
      });
    }

    const { nome, email, senha, perguntaSeguranca, respostaSeguranca } = validation.data;
    
    // Check if email already exists
    const existingUser = await prisma.usuario.findUnique({
      where: { email }
    });
    
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: "Email já cadastrado"
      });
    }

    const hashedPassword = await bcrypt.hash(senha, SALT_ROUNDS);
    const codigoAtivacao = Math.random().toString(36).substring(2, 6).toUpperCase();

    const usuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        senha: hashedPassword,
        codigoAtivacao,
        status: "INATIVO",
        perguntaSeguranca,
        respostaSeguranca: respostaSeguranca 
          ? await bcrypt.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS) 
          : null
      }
    });

    // Send activation email
    await sendActivationEmail(email, nome, codigoAtivacao);

    // Log the registration
    await logAction('CADASTRO_USUARIO', `Novo usuário cadastrado: ${email}`, usuario.id);

    res.status(201).json({
      success: true,
      message: "Usuário cadastrado com sucesso. Verifique seu email para ativar a conta."
    });
  } catch (error) {
    handleError(res, error, "user registration");
  }
});

router.post("/ativar", authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = activateAccountSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        details: validation.error.errors
      });
    }

    const { email, codigo } = validation.data;

    const usuario = await prisma.usuario.findFirst({ 
      where: { 
        email,
        deleted: false 
      } 
    });
    
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    if (usuario.status === 'ATIVO') {
      return res.status(400).json({ 
        success: false,
        error: 'Conta já está ativada' 
      });
    }
    if (usuario.codigoAtivacao !== codigo) {
      return res.status(400).json({ 
        success: false,
        error: 'Código de ativação inválido' 
      });
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { 
        status: 'ATIVO',
        codigoAtivacao: null 
      }
    });

    await logAction('ATIVACAO_CONTA', `Usuário ativou a conta: ${email}`, usuario.id);

    const token = generateToken(usuario.id, usuario.nivelAcesso);
    const newRefreshToken = refreshToken(usuario.id, usuario.nivelAcesso);

    res.json({ 
      success: true,
      data: {
        token,
        refreshToken: newRefreshToken,
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          nivelAcesso: usuario.nivelAcesso
        }
      },
      message: 'Conta ativada com sucesso'
    });
  } catch (error) {
    handleError(res, error, "account activation");
  }
});

// LOGIN ROUTE FIXED
router.post("/login", authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        details: validation.error.errors
      });
    }

    const { email, senha } = validation.data;

    const usuario = await prisma.usuario.findFirst({ 
      where: { 
        email,
        deleted: false 
      } 
    });

    if (!usuario || !usuario.senha) {
      return res.status(401).json({ 
        success: false,
        error: "Credenciais inválidas" 
      });
    }

    if (usuario.bloqueado) {
      return res.status(403).json({ 
        success: false,
        error: "Conta bloqueada. Entre em contato com o administrador." 
      });
    }

    if (usuario.status !== "ATIVO") {
      return res.status(403).json({ 
        success: false,
        error: "Conta não ativada. Verifique seu email." 
      });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    
    if (!senhaValida) {
      // Increment login attempts
      const tentativas = usuario.tentativasLogin + 1;
      const bloqueado = tentativas >= 3;
      
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { 
          tentativasLogin: tentativas,
          bloqueado
        }
      });

      await logAction(
        'TENTATIVA_LOGIN_FALHA', 
        `Tentativa ${tentativas} de login falhou para ${email}`,
        usuario.id
      );

      return res.status(401).json({ 
        success: false,
        error: 'Credenciais inválidas',
        data: {
          tentativasRestantes: 3 - tentativas,
          bloqueado
        }
      });
    }

    // Reset login attempts on successful login
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { 
        tentativasLogin: 0,
        ultimoLogin: new Date()
      }
    });

    await logAction('LOGIN', `Login bem-sucedido para ${email}`, usuario.id);

    const token = generateToken(usuario.id, usuario.nivelAcesso);
    const newRefreshToken = refreshToken(usuario.id, usuario.nivelAcesso);

    res.json({ 
      success: true,
      data: {
        token,
        refreshToken: newRefreshToken,
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          nivelAcesso: usuario.nivelAcesso,
          ultimoLogin: usuario.ultimoLogin 
            ? usuario.ultimoLogin.toISOString()
            : null
        }
      }
    });
  } catch (error) {
    handleError(res, error, "user login");
  }
});

router.post("/refresh-token", async (req: AuthenticatedRequest, res: Response) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(401).json({ 
      success: false,
      error: 'Refresh token não fornecido' 
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET) as { id: number };
    
    const usuario = await prisma.usuario.findFirst({
      where: { 
        id: decoded.id,
        deleted: false 
      }
    });

    if (!usuario || usuario.bloqueado || usuario.status !== 'ATIVO') {
      return res.status(403).json({ 
        success: false,
        error: 'Acesso negado. Conta inativa ou bloqueada.' 
      });
    }

    const newToken = generateToken(usuario.id, usuario.nivelAcesso);
    const newRefreshToken = refreshToken(usuario.id, usuario.nivelAcesso);

    res.json({ 
      success: true,
      data: {
        token: newToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    res.status(403).json({ 
      success: false,
      error: 'Refresh token inválido ou expirado' 
    });
  }
});

router.post("/recuperar-senha", authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email é obrigatório' 
      });
    }

    const usuario = await prisma.usuario.findFirst({ 
      where: { 
        email,
        deleted: false 
      } 
    });
    
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        error: 'Usuário não encontrado' 
      });
    }

    const codigoRecuperacao = Math.random().toString(36).substring(2, 6).toUpperCase();

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { codigoAtivacao: codigoRecuperacao }
    });

    await transporter.sendMail({
      from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
      to: email,
      subject: 'Recuperação de senha',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">Olá ${usuario.nome},</h2>
          <p>Seu código de recuperação é: <strong style="font-size: 1.2em;">${codigoRecuperacao}</strong></p>
          <p>Use este código para redefinir sua senha.</p>
          <p>Ou clique no link abaixo:</p>
          <div style="margin: 20px 0;">
            <a href="${process.env.APP_URL}/redefinir-senha?email=${encodeURIComponent(email)}&codigo=${codigoRecuperacao}" 
               style="display: inline-block; padding: 10px 20px; background-color: #5c43e7; color: white; text-decoration: none; border-radius: 4px;">
              Redefinir minha senha
            </a>
          </div>
          <p style="font-size: 0.9em; color: #7f8c8d;">
            Se você não solicitou a redefinição de senha, por favor ignore este e-mail.
          </p>
        </div>
      `
    });

    await logAction(
      'SOLICITACAO_RECUPERACAO_SENHA', 
      `Solicitação de recuperação de senha para ${email}`,
      usuario.id
    );

    res.json({ 
      success: true, 
      message: 'Código de recuperação enviado para seu email' 
    });
  } catch (error) {
    handleError(res, error, "password recovery request");
  }
});

router.post("/redefinir-senha", authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = passwordResetSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: "Validation error",
        details: validation.error.errors
      });
    }

    const { email, codigo, resposta, novaSenha } = validation.data;

    const usuario = await prisma.usuario.findFirst({ 
      where: { 
        email,
        deleted: false 
      } 
    });
    
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        error: 'Usuário não encontrado' 
      });
    }

    // Verify either code or security answer
    if (codigo) {
      if (usuario.codigoAtivacao !== codigo) {
        return res.status(400).json({ 
          success: false,
          error: 'Código de recuperação inválido' 
        });
      }
    } else if (resposta && usuario.respostaSeguranca) {
      const respostaValida = await bcrypt.compare(resposta.toLowerCase(), usuario.respostaSeguranca);
      
      if (!respostaValida) {
        return res.status(401).json({ 
          success: false,
          error: 'Resposta de segurança incorreta' 
        });
      }
    } else {
      return res.status(400).json({ 
        success: false,
        error: 'Código ou resposta de segurança é obrigatório' 
      });
    }

    const hashedPassword = await bcrypt.hash(novaSenha, SALT_ROUNDS);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { 
        senha: hashedPassword,
        codigoAtivacao: null,
        bloqueado: false,
        tentativasLogin: 0
      }
    });

    await logAction(
      'REDEFINICAO_SENHA', 
      `Senha redefinida para ${email}`,
      usuario.id
    );

    const token = generateToken(usuario.id, usuario.nivelAcesso);
    const newRefreshToken = refreshToken(usuario.id, usuario.nivelAcesso);

    res.json({ 
      success: true,
      data: {
        token,
        refreshToken: newRefreshToken
      },
      message: 'Senha redefinida com sucesso'
    });
  } catch (error) {
    handleError(res, error, "password reset");
  }
});

// Authenticated routes
router.get("/perfil", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user?.id },
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
      return res.status(404).json({ 
        success: false,
        error: 'Usuário não encontrado' 
      });
    }

    res.json({ 
      success: true,
      data: usuario 
    });
  } catch (error) {
    handleError(res, error, "fetching user profile");
  }
});

router.put("/perfil", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { nome, perguntaSeguranca, respostaSeguranca } = req.body;

    const updateData: any = {};
    if (nome) updateData.nome = nome;
    if (perguntaSeguranca) updateData.perguntaSeguranca = perguntaSeguranca;
    if (respostaSeguranca) {
      updateData.respostaSeguranca = await bcrypt.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS);
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.user?.id },
      data: updateData,
      select: {
        id: true,
        nome: true,
        email: true,
        perguntaSeguranca: true
      }
    });

    await logAction(
      'ATUALIZACAO_PERFIL', 
      `Usuário atualizou perfil: ${usuario.email}`,
      usuario.id
    );

    res.json({ 
      success: true,
      data: usuario 
    });
  } catch (error) {
    handleError(res, error, "updating user profile");
  }
});

router.put("/alterar-senha", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { senhaAtual, novaSenha } = req.body;

    if (!senhaAtual || !novaSenha) {
      return res.status(400).json({ 
        success: false,
        error: 'Senha atual e nova senha são obrigatórias' 
      });
    }

    const validation = usuarioSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
    if (!validation.success) {
      return res.status(400).json({ 
        success: false,
        error: "Validation error",
        details: validation.error.errors 
      });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user?.id }
    });

    if (!usuario || !usuario.senha) {
      return res.status(404).json({ 
        success: false,
        error: 'Usuário não encontrado' 
      });
    }

    const senhaValida = await bcrypt.compare(senhaAtual, usuario.senha);
    if (!senhaValida) {
      return res.status(401).json({ 
        success: false,
        error: 'Senha atual incorreta' 
      });
    }

    const hashedPassword = await bcrypt.hash(novaSenha, SALT_ROUNDS);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { 
        senha: hashedPassword,
        bloqueado: false,
        tentativasLogin: 0
      }
    });

    await logAction(
      'ALTERACAO_SENHA', 
      `Usuário alterou senha: ${usuario.email}`,
      usuario.id
    );

    res.json({ 
      success: true, 
      message: 'Senha alterada com sucesso' 
    });
  } catch (error) {
    handleError(res, error, "changing password");
  }
});

// Route to fetch user logs
router.get("/logs", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = await prisma.log.findMany({
      where: { usuarioId: req.user?.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    handleError(res, error, "fetching logs");
  }
});
router.get("/", authenticateJWT, checkPermission(3), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { deleted: false },
      select: {
        id: true,
        nome: true,
        email: true,
        status: true,
        nivelAcesso: true,
        bloqueado: true,
        ultimoLogin: true,
        createdAt: true
      }
    });

    res.json({
      success: true,
      data: usuarios
    });
  } catch (error) {
    handleError(res, error, "fetching users");
  }
});
router.put("/:id", authenticateJWT, checkPermission(3), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { nivelAcesso, bloqueado } = req.body;

    const usuario = await prisma.usuario.update({
      where: { id: Number(req.params.id) },
      data: {
        nivelAcesso,
        bloqueado
      },
      select: {
        id: true,
        nome: true,
        email: true,
        status: true,
        nivelAcesso: true,
        bloqueado: true
      }
    });

    await logAction(
      'ATUALIZACAO_USUARIO', 
      `Usuário ${usuario.email} atualizado por ${req.user?.email}`,
      req.user?.id
    );

    res.json({ 
      success: true,
      data: usuario 
    });
  } catch (error) {
    handleError(res, error, "updating user");
  }
});

router.delete("/:id", authenticateJWT, checkPermission(3), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const usuario = await prisma.usuario.update({
      where: { id: Number(req.params.id) },
      data: { 
        deleted: true,
        deletedAt: new Date(),
        status: 'INATIVO',
        bloqueado: true
      }
    });

    await logAction(
      'EXCLUSAO_USUARIO', 
      `Usuário ${usuario.email} excluído por ${req.user?.email}`,
      req.user?.id
    );

    res.json({ 
      success: true, 
      message: 'Usuário marcado como excluído com sucesso' 
    });
  } catch (error) {
    handleError(res, error, "deleting user");
  }
});

export default router;