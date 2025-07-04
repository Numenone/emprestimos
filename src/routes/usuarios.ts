// src/routes/usuarios.ts
import { PrismaClient } from '@prisma/client';
import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { 
  generateToken,
  authenticateJWT, 
  checkPermission,
  refreshToken
} from '../auth/jwt';
import path from 'path';
import fs from 'fs';
import { AuthenticatedRequest } from '../types/express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();
const router = Router();
const SALT_ROUNDS = 10;

const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
  port: parseInt(process.env.MAILTRAP_PORT || "2525"),
  auth: {
    user: process.env.MAILTRAP_USER || '',
    pass: process.env.MAILTRAP_PASS || ''
  }
});

const usuarioSchema = z.object({
  nome: z.string().min(3),
  email: z.string().email(),
  senha: z.string().min(8)
    .regex(/[A-Z]/, "Deve conter pelo menos uma letra maiúscula")
    .regex(/[a-z]/, "Deve conter pelo menos uma letra minúscula")
    .regex(/[0-9]/, "Deve conter pelo menos um número")
    .regex(/[^A-Za-z0-9]/, "Deve conter pelo menos um símbolo"),
  perguntaSeguranca: z.string().min(5, "Pergunta deve ter pelo menos 5 caracteres"),
  respostaSeguranca: z.string().min(2, "Resposta deve ter pelo menos 2 caracteres")
});

// Rotas públicas
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Adicione verificação do corpo da requisição
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: "Corpo da requisição inválido" });
    }

    const validation = usuarioSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ 
        error: "Dados inválidos",
        details: validation.error.errors 
      });
    }

    const { nome, email, senha, perguntaSeguranca, respostaSeguranca } = validation.data;
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
        respostaSeguranca: await bcrypt.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS)
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

    await transporter.sendMail(mailOptions);

    // Registrar log
    await prisma.log.create({
      data: {
        acao: 'CADASTRO_USUARIO',
        detalhes: `Novo usuário cadastrado: ${email}`,
        usuarioId: usuario.id
      }
    });

    // Retorne JSON com status 201
    res.status(201).json({
      success: true,
      message: "Usuário cadastrado com sucesso"
    });
  } catch (error: any) {
    console.error('Erro no cadastro:', error);
    res.status(500).json({ error: error.message || "Erro ao cadastrar usuário" }); 
  }
});

router.post("/login", async (req: AuthenticatedRequest, res: Response) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ 
      where: { email, deleted: false } 
    });

    if (!usuario || !usuario.senha) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    if (usuario.bloqueado) {
      return res.status(403).json({ 
        error: "Conta bloqueada. Entre em contato com o administrador." 
      });
    }

    if (usuario.status !== "ATIVO") {
      return res.status(403).json({ 
        error: "Conta não ativada. Verifique seu email." 
      });
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

      await prisma.log.create({
        data: {
          acao: 'TENTATIVA_LOGIN_FALHA',
          detalhes: `Tentativa ${tentativas} de login falhou para ${email}`,
          usuarioId: usuario.id
        }
      });

      return res.status(401).json({ 
        error: 'Credenciais inválidas',
        tentativasRestantes: 3 - tentativas,
        bloqueado
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

    await prisma.log.create({
      data: {
        acao: 'LOGIN',
        detalhes: `Login bem-sucedido para ${email}`,
        usuarioId: usuario.id
      }
    });

    const token = generateToken(usuario.id, usuario.nivelAcesso);
    const refresh = refreshToken(usuario.id, usuario.nivelAcesso);

    res.json({ 
      success: true,
      token,
      refresh,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        nivelAcesso: usuario.nivelAcesso,
        ultimoLogin: usuario.ultimoLogin 
          ? `Seu último acesso foi em ${usuario.ultimoLogin.toLocaleString()}` 
          : 'Este é seu primeiro acesso'
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao realizar login" });
  }
});

router.post("/ativar", async (req: AuthenticatedRequest, res: Response) => {
  const { email, codigo } = req.body;
  
  if (!email || !codigo) {
    return res.status(400).json({ error: 'Email e código são obrigatórios' });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ 
      where: { email, deleted: false } 
    });
    
    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (usuario.status === 'ATIVO') {
      return res.status(400).json({ error: 'Conta já está ativa' });
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

    await prisma.log.create({
      data: {
        acao: 'ATIVACAO_CONTA',
        detalhes: `Usuário ativou a conta: ${email}`,
        usuarioId: usuario.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Conta ativada com sucesso',
      token: generateToken(usuario.id, usuario.nivelAcesso)
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao ativar conta' });
  }
});

router.post("/recuperar-senha", async (req: AuthenticatedRequest, res: Response) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email é obrigatório' });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ 
      where: { email, deleted: false } 
    });
    
    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const codigoRecuperacao = Math.random().toString(36).substring(2, 6).toUpperCase();

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { codigoAtivacao: codigoRecuperacao }
    });

    const mailOptions = {
      from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
      to: email,
      subject: 'Recuperação de senha',
      html: `
        <h2>Olá ${usuario.nome},</h2>
        <p>Seu código de recuperação é: <strong>${codigoRecuperacao}</strong></p>
        <p>Use este código para redefinir sua senha.</p>
        <p>Ou clique no link abaixo:</p>
        <a href="${process.env.APP_URL}/redefinir-senha?email=${encodeURIComponent(email)}&codigo=${codigoRecuperacao}">
          Redefinir minha senha
        </a>
      `
    };

    await transporter.sendMail(mailOptions);

    await prisma.log.create({
      data: {
        acao: 'SOLICITACAO_RECUPERACAO_SENHA',
        detalhes: `Solicitação de recuperação de senha para ${email}`,
        usuarioId: usuario.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Código de recuperação enviado para seu email' 
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao processar recuperação de senha' });
  }
});

router.post("/redefinir-senha", async (req: AuthenticatedRequest, res: Response) => {
  const { email, codigo, novaSenha } = req.body;
  
  if (!email || !codigo || !novaSenha) {
    return res.status(400).json({ error: 'Email, código e nova senha são obrigatórios' });
  }

  try {
    const validation = usuarioSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Senha inválida",
        details: validation.error.errors 
      });
    }

    const usuario = await prisma.usuario.findUnique({ 
      where: { email, deleted: false } 
    });
    
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
        codigoAtivacao: null,
        bloqueado: false,
        tentativasLogin: 0
      }
    });

    await prisma.log.create({
      data: {
        acao: 'REDEFINICAO_SENHA',
        detalhes: `Senha redefinida para ${email}`,
        usuarioId: usuario.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Senha redefinida com sucesso',
      token: generateToken(usuario.id, usuario.nivelAcesso)
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

router.post("/redefinir-senha-pergunta", async (req: AuthenticatedRequest, res: Response) => {
  const { email, resposta, novaSenha } = req.body;
  
  if (!email || !resposta || !novaSenha) {
    return res.status(400).json({ error: 'Email, resposta e nova senha são obrigatórios' });
  }

  try {
    const validation = usuarioSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Senha inválida",
        details: validation.error.errors 
      });
    }

    const usuario = await prisma.usuario.findUnique({ 
      where: { email, deleted: false } 
    });
    
    if (!usuario || !usuario.respostaSeguranca) {
      return res.status(404).json({ error: 'Usuário não encontrado ou sem pergunta de segurança' });
    }

    const respostaValida = await bcrypt.compare(resposta.toLowerCase(), usuario.respostaSeguranca);
    
    if (!respostaValida) {
      return res.status(401).json({ error: 'Resposta de segurança incorreta' });
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

    await prisma.log.create({
      data: {
        acao: 'REDEFINICAO_SENHA_PERGUNTA',
        detalhes: `Senha redefinida via pergunta de segurança para ${email}`,
        usuarioId: usuario.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Senha redefinida com sucesso',
      token: generateToken(usuario.id, usuario.nivelAcesso)
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

router.put("/alterar-senha", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const { senhaAtual, novaSenha } = req.body;

  if (!senhaAtual || !novaSenha) {
    return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
  }

  try {
    const validation = usuarioSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Senha inválida",
        details: validation.error.errors 
      });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user?.id, deleted: false }
    });

    if (!usuario || !usuario.senha) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const senhaValida = await bcrypt.compare(senhaAtual, usuario.senha);
    if (!senhaValida) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
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

    await prisma.log.create({
      data: {
        acao: 'ALTERACAO_SENHA',
        detalhes: `Usuário alterou senha: ${usuario.email}`,
        usuarioId: usuario.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Senha alterada com sucesso' 
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao alterar senha' });
  }
});



router.get("/perfil", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id, deleted: false },
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
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(usuario);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
});

router.put("/perfil", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const { nome, perguntaSeguranca, respostaSeguranca } = req.body;

  try {
    const updateData: any = {};
    if (nome) updateData.nome = nome;
    if (perguntaSeguranca) updateData.perguntaSeguranca = perguntaSeguranca;
    if (respostaSeguranca) {
      updateData.respostaSeguranca = await bcrypt.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS);
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.user?.id, deleted: false },
      data: updateData,
      select: {
        id: true,
        nome: true,
        email: true,
        perguntaSeguranca: true
      }
    });

    await prisma.log.create({
      data: {
        acao: 'ATUALIZACAO_PERFIL',
        detalhes: `Usuário atualizou perfil: ${usuario.email}`,
        usuarioId: usuario.id
      }
    });

    res.json({ success: true, usuario });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
});


router.get("/logs", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = await prisma.log.findMany({
      where: { usuarioId: req.user?.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

router.post("/backup", authenticateJWT, checkPermission(3), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFile = path.join(backupDir, `backup-${Date.now()}.json`);
    const backupData = {
      usuarios: await prisma.usuario.findMany({ where: { deleted: false } }),
      alunos: await prisma.aluno.findMany({ where: { deleted: false } }),
      livros: await prisma.livro.findMany({ where: { deleted: false } }),
      emprestimos: await prisma.emprestimo.findMany({ where: { deleted: false } })
    };

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

    await prisma.log.create({
      data: {
        acao: 'BACKUP',
        detalhes: `Backup realizado por ${req.user?.email}`,
        usuarioId: req.user?.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Backup realizado com sucesso',
      file: backupFile
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao realizar backup' });
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

    await prisma.log.create({
      data: {
        acao: 'EXCLUSAO_USUARIO',
        detalhes: `Usuário ${usuario.email} excluído por ${req.user?.email}`,
        usuarioId: req.user?.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Usuário marcado como excluído com sucesso' 
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir usuário' });
  }
});

export default router;