import { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

// Configuração do Nodemailer - Versão melhorada
const mailConfig = {
  host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
  port: parseInt(process.env.MAILTRAP_PORT || "587"), // Alterado para 587 que é mais comum
  secure: false, // true para 465, false para outras portas
  auth: {
    user: process.env.MAILTRAP_USER || '', 
    pass: process.env.MAILTRAP_PASS || ''
  },
  tls: {
    rejectUnauthorized: false // Para evitar problemas com certificados em ambiente de desenvolvimento
  }
};

// Verifica se as credenciais estão configuradas
if (!mailConfig.auth.user || !mailConfig.auth.pass) {
  console.error('❌ Erro: Credenciais de email não configuradas!');
  console.warn('Configure as variáveis MAILTRAP_USER e MAILTRAP_PASS no arquivo .env');
}

const transporter = nodemailer.createTransport(mailConfig);

// Verifica a conexão com o servidor SMTP
transporter.verify((error) => {
  if (error) {
    console.error('❌ Falha ao conectar ao servidor de email:', error);
  } else {
    console.log('✅ Servidor de email configurado com sucesso');
  }
});

// ... (restante do código permanece igual até a função de enviar email)

// POST enviar email com empréstimos ativos (com rate limiting)
router.post("/:id/email", emailRateLimiter, async (req: Request, res: Response) => {
  try {
    // Verifica novamente se as credenciais estão configuradas
    if (!mailConfig.auth.user || !mailConfig.auth.pass) {
      return res.status(500).json({
        error: 'Serviço de email não configurado',
        details: 'As credenciais de email não foram configuradas no servidor'
      });
    }

    const aluno = await prisma.aluno.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        emprestimos: {
          where: { devolvido: false },
          include: { 
            livro: { select: { id: true, titulo: true, autor: true, quantidade: true } }
          },
          orderBy: { dataDevolucao: 'asc' }
        }
      }
    });

    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    if (!aluno.email) {
      return res.status(400).json({ error: 'Aluno não possui email cadastrado' });
    }

    if (aluno.emprestimos.length === 0) {
      return res.json({ 
        message: 'Aluno não possui empréstimos ativos',
        alunoId: aluno.id
      });
    }

    const emailHtml = generateEmailHtml(aluno);

    const mailOptions = {
      from: process.env.MAILTRAP_FROM || `"Biblioteca" <${mailConfig.auth.user}>`,
      to: aluno.email,
      subject: `[Biblioteca] Empréstimos Ativos - ${aluno.nome}`,
      html: emailHtml,
      // Adicionando headers para melhorar a entrega
      headers: {
        'X-Mailer': 'Node.js',
        'X-Priority': '3',
        'Importance': 'Normal'
      }
    };

    // Adicionando timeout para evitar que a requisição fique travada
    const sendMailPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout ao enviar email')), 15000)
    );

    const info = await Promise.race([sendMailPromise, timeoutPromise]);
    console.log('E-mail enviado:', info);

    res.json({
      success: true,
      message: `E-mail enviado para ${aluno.email}`,
      emprestimos: aluno.emprestimos.length,
      messageId: info.messageId
    });

  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    
    // Tratamento de erros mais específico
    let errorMessage = 'Falha ao enviar e-mail';
    let errorDetails = error instanceof Error ? error.message : String(error);
    
    if (error instanceof Error && 'code' in error) {
      switch (error.code) {
        case 'EAUTH':
          errorMessage = 'Falha de autenticação no servidor de email';
          break;
        case 'ECONNECTION':
          errorMessage = 'Não foi possível conectar ao servidor de email';
          break;
        case 'ETIMEDOUT':
          errorMessage = 'Timeout ao conectar ao servidor de email';
          break;
      }
    }

    res.status(500).json({
      error: errorMessage,
      details: errorDetails
    });
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
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Quantidade</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Empréstimo</th>
            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Data Devolução</th>
          </tr>
        </thead>
        <tbody>
          ${aluno.emprestimos.map(emp => {
            const livro = emp.livro ?? { titulo: 'Livro não encontrado', autor: 'N/A', quantidade: 0 };
            return `
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.titulo}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.autor}</td>
                <td style="padding: 10px; border-bottom: 1px solid #ddd;">${livro.quantidade}</td>
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
