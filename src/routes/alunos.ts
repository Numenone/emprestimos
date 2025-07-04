// src/routes/alunos.ts
import { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { 
  generateToken, 
  authenticateJWT, 
  checkPermission,
  refreshToken
} from '../auth/jwt';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

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

const alunoSchema = z.object({
  nome: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  email: z.string().email("Email inválido"),
  matricula: z.string().min(5, "Matrícula deve ter pelo menos 5 caracteres"),
  senha: z.string()
    .min(8, "Senha deve ter pelo menos 8 caracteres")
    .regex(/[A-Z]/, "Senha deve conter pelo menos uma letra maiúscula")
    .regex(/[a-z]/, "Senha deve conter pelo menos uma letra minúscula")
    .regex(/[0-9]/, "Senha deve conter pelo menos um número")
    .regex(/[^A-Za-z0-9]/, "Senha deve conter pelo menos um símbolo"),
  perguntaSeguranca: z.string().min(5, "Pergunta de segurança deve ter pelo menos 5 caracteres").optional(),
  respostaSeguranca: z.string().min(2, "Resposta de segurança deve ter pelo menos 2 caracteres").optional()
});

// Rotas públicas
router.post("/", async (req: Request, res: Response) => {
  const validation = alunoSchema.safeParse(req.body);
  
  if (!validation.success) {
    return res.status(400).json({ 
      error: "Dados inválidos",
      details: validation.error.errors 
    });
  }

  try {
    const { nome, email, matricula, senha, perguntaSeguranca, respostaSeguranca } = validation.data;
    const hashedPassword = await bcrypt.hash(senha, SALT_ROUNDS);
    const codigoAtivacao = Math.random().toString(36).substring(2, 6).toUpperCase();

    const aluno = await prisma.aluno.create({
      data: {
        nome,
        email,
        matricula,
        senha: hashedPassword,
        codigoAtivacao,
        status: "INATIVO",
        perguntaSeguranca,
        respostaSeguranca: respostaSeguranca ? await bcrypt.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS) : null
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
        acao: 'CADASTRO_ALUNO',
        detalhes: `Novo aluno cadastrado: ${email}`,
        alunoId: aluno.id
      }
    });

    res.status(201).json({
      success: true,
      message: "Aluno cadastrado com sucesso. Verifique seu email para ativar a conta."
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ 
        error: "Email ou matrícula já cadastrados" 
      });
    }
    res.status(500).json({ error: "Erro ao cadastrar aluno" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ error: "Email e senha são obrigatórios" });
  }

  try {
    const aluno = await prisma.aluno.findUnique({ 
      where: { email, deleted: false } 
    });

    if (!aluno || !aluno.senha) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    if (aluno.bloqueado) {
      return res.status(403).json({ 
        error: "Conta bloqueada. Entre em contato com o administrador." 
      });
    }

    if (aluno.status !== "ATIVO") {
      return res.status(403).json({ 
        error: "Conta não ativada. Verifique seu email." 
      });
    }

    const senhaValida = await bcrypt.compare(senha, aluno.senha);
    
    if (!senhaValida) {
      // Incrementar tentativas de login
      const tentativas = aluno.tentativasLogin + 1;
      const bloqueado = tentativas >= 3;
      
      await prisma.aluno.update({
        where: { id: aluno.id },
        data: { 
          tentativasLogin: tentativas,
          bloqueado
        }
      });

      await prisma.log.create({
        data: {
          acao: 'TENTATIVA_LOGIN_FALHA',
          detalhes: `Tentativa ${tentativas} de login falhou para ${email}`,
          alunoId: aluno.id
        }
      });

      return res.status(401).json({ 
        error: 'Credenciais inválidas',
        tentativasRestantes: 3 - tentativas,
        bloqueado
      });
    }

    // Resetar tentativas de login
    await prisma.aluno.update({
      where: { id: aluno.id },
      data: { 
        tentativasLogin: 0,
        ultimoLogin: new Date()
      }
    });

    await prisma.log.create({
      data: {
        acao: 'LOGIN',
        detalhes: `Login bem-sucedido para ${email}`,
        alunoId: aluno.id
      }
    });

    const token = generateToken(aluno.id, aluno.nivelAcesso);
    const refresh = refreshToken(aluno.id, aluno.nivelAcesso);

    res.json({ 
      success: true,
      token,
      refresh,
      aluno: {
        id: aluno.id,
        nome: aluno.nome,
        email: aluno.email,
        nivelAcesso: aluno.nivelAcesso,
        ultimoLogin: aluno.ultimoLogin 
          ? `Seu último acesso foi em ${aluno.ultimoLogin.toLocaleString()}` 
          : 'Este é seu primeiro acesso'
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao realizar login" });
  }
});

router.post("/ativar", async (req: Request, res: Response) => {
  const { email, codigo } = req.body;
  
  if (!email || !codigo) {
    return res.status(400).json({ error: 'Email e código são obrigatórios' });
  }

  try {
    const aluno = await prisma.aluno.findUnique({ 
      where: { email, deleted: false } 
    });
    
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    if (aluno.status === 'ATIVO') {
      return res.status(400).json({ error: 'Conta já está ativa' });
    }

    if (aluno.codigoAtivacao !== codigo) {
      return res.status(400).json({ error: 'Código de ativação inválido' });
    }

    await prisma.aluno.update({
      where: { id: aluno.id },
      data: { 
        status: 'ATIVO',
        codigoAtivacao: null 
      }
    });

    await prisma.log.create({
      data: {
        acao: 'ATIVACAO_CONTA',
        detalhes: `Aluno ativou a conta: ${email}`,
        alunoId: aluno.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Conta ativada com sucesso',
      token: generateToken(aluno.id, aluno.nivelAcesso)
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao ativar conta' });
  }
});

router.post("/recuperar-senha", async (req: Request, res: Response) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email é obrigatório' });
  }

  try {
    const aluno = await prisma.aluno.findUnique({ 
      where: { email, deleted: false } 
    });
    
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    const codigoRecuperacao = Math.random().toString(36).substring(2, 6).toUpperCase();

    await prisma.aluno.update({
      where: { id: aluno.id },
      data: { codigoAtivacao: codigoRecuperacao }
    });

    const mailOptions = {
      from: process.env.MAIL_FROM || '"Biblioteca" <biblioteca@example.com>',
      to: email,
      subject: 'Recuperação de senha',
      html: `
        <h2>Olá ${aluno.nome},</h2>
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
        alunoId: aluno.id
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

router.post("/redefinir-senha", async (req: Request, res: Response) => {
  const { email, codigo, novaSenha } = req.body;
  
  if (!email || !codigo || !novaSenha) {
    return res.status(400).json({ error: 'Email, código e nova senha são obrigatórios' });
  }

  try {
    const validation = alunoSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Senha inválida",
        details: validation.error.errors 
      });
    }

    const aluno = await prisma.aluno.findUnique({ 
      where: { email, deleted: false } 
    });
    
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    if (aluno.codigoAtivacao !== codigo) {
      return res.status(400).json({ error: 'Código de recuperação inválido' });
    }

    const hashedPassword = await bcrypt.hash(novaSenha, SALT_ROUNDS);

    await prisma.aluno.update({
      where: { id: aluno.id },
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
        alunoId: aluno.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Senha redefinida com sucesso',
      token: generateToken(aluno.id, aluno.nivelAcesso)
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

router.post("/redefinir-senha-pergunta", async (req: Request, res: Response) => {
  const { email, resposta, novaSenha } = req.body;
  
  if (!email || !resposta || !novaSenha) {
    return res.status(400).json({ error: 'Email, resposta e nova senha são obrigatórios' });
  }

  try {
    const validation = alunoSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Senha inválida",
        details: validation.error.errors 
      });
    }

    const aluno = await prisma.aluno.findUnique({ 
      where: { email, deleted: false } 
    });
    
    if (!aluno || !aluno.respostaSeguranca) {
      return res.status(404).json({ error: 'Aluno não encontrado ou sem pergunta de segurança' });
    }

    const respostaValida = await bcrypt.compare(resposta.toLowerCase(), aluno.respostaSeguranca);
    
    if (!respostaValida) {
      return res.status(401).json({ error: 'Resposta de segurança incorreta' });
    }

    const hashedPassword = await bcrypt.hash(novaSenha, SALT_ROUNDS);

    await prisma.aluno.update({
      where: { id: aluno.id },
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
        alunoId: aluno.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Senha redefinida com sucesso',
      token: generateToken(aluno.id, aluno.nivelAcesso)
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

// Rotas protegidas
router.get("/perfil", authenticateJWT, async (req: Request, res: Response) => {
  try {
    const aluno = await prisma.aluno.findUnique({
      where: { id: req.aluno.id, deleted: false },
      select: {
        id: true,
        nome: true,
        email: true,
        matricula: true,
        status: true,
        nivelAcesso: true,
        ultimoLogin: true,
        perguntaSeguranca: true,
        createdAt: true
      }
    });

    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    res.json(aluno);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
});

router.put("/perfil", authenticateJWT, async (req: Request, res: Response) => {
  const { nome, perguntaSeguranca, respostaSeguranca } = req.body;

  try {
    const updateData: any = {};
    if (nome) updateData.nome = nome;
    if (perguntaSeguranca) updateData.perguntaSeguranca = perguntaSeguranca;
    if (respostaSeguranca) {
      updateData.respostaSeguranca = await bcrypt.hash(respostaSeguranca.toLowerCase(), SALT_ROUNDS);
    }

    const aluno = await prisma.aluno.update({
      where: { id: req.aluno.id, deleted: false },
      data: updateData,
      select: {
        id: true,
        nome: true,
        email: true,
        matricula: true,
        perguntaSeguranca: true
      }
    });

    await prisma.log.create({
      data: {
        acao: 'ATUALIZACAO_PERFIL',
        detalhes: `Aluno atualizou perfil: ${aluno.email}`,
        alunoId: aluno.id
      }
    });

    res.json({ success: true, aluno });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
});

router.put("/alterar-senha", authenticateJWT, async (req: Request, res: Response) => {
  const { senhaAtual, novaSenha } = req.body;

  if (!senhaAtual || !novaSenha) {
    return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
  }

  try {
    const validation = alunoSchema.pick({ senha: true }).safeParse({ senha: novaSenha });
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Senha inválida",
        details: validation.error.errors 
      });
    }

    const aluno = await prisma.aluno.findUnique({
      where: { id: req.aluno.id, deleted: false }
    });

    if (!aluno || !aluno.senha) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    const senhaValida = await bcrypt.compare(senhaAtual, aluno.senha);
    if (!senhaValida) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }

    const hashedPassword = await bcrypt.hash(novaSenha, SALT_ROUNDS);

    await prisma.aluno.update({
      where: { id: aluno.id },
      data: { 
        senha: hashedPassword,
        bloqueado: false,
        tentativasLogin: 0
      }
    });

    await prisma.log.create({
      data: {
        acao: 'ALTERACAO_SENHA',
        detalhes: `Aluno alterou senha: ${aluno.email}`,
        alunoId: aluno.id
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

router.get("/logs", authenticateJWT, checkPermission(3), async (req: Request, res: Response) => {
  try {
    const logs = await prisma.log.findMany({
      where: { alunoId: req.aluno.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

router.post("/backup", authenticateJWT, checkPermission(3), async (req: Request, res: Response) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFile = path.join(backupDir, `backup-${Date.now()}.json`);
    const backupData = {
      alunos: await prisma.aluno.findMany({ where: { deleted: false } }),
      livros: await prisma.livro.findMany({ where: { deleted: false } }),
      emprestimos: await prisma.emprestimo.findMany({ where: { deleted: false } })
    };

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

    await prisma.log.create({
      data: {
        acao: 'BACKUP',
        detalhes: `Backup realizado por ${req.aluno.email}`,
        alunoId: req.aluno.id
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

router.delete("/:id", authenticateJWT, checkPermission(3), async (req: Request, res: Response) => {
  try {
    const aluno = await prisma.aluno.update({
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
        acao: 'EXCLUSAO_ALUNO',
        detalhes: `Aluno ${aluno.email} excluído por ${req.aluno.email}`,
        alunoId: req.aluno.id
      }
    });

    res.json({ 
      success: true, 
      message: 'Aluno marcado como excluído com sucesso' 
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir aluno' });
  }
});

// Função auxiliar para gerar HTML do email
function generateEmailHtml(aluno: Aluno & { emprestimos: EmprestimoComLivro[] }): string {
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
          ${aluno.emprestimos.map((emp: EmprestimoComLivro) => {
            const livro = emp.livro ?? { titulo: 'Livro não encontrado', autor: 'N/A', quantidade: 0 };
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
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export default router;