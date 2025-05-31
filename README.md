###Sistema de Biblioteca - Backend + Frontend###
####Este projeto é um sistema de gerenciamento de biblioteca com backend em Node.js/Express e frontend web.####

📋 Pré-requisitos
Node.js v16+

npm v8+

Banco de dados PostgreSQL

Git (opcional)

🛠 Instalação
Clone o repositório:

bash
git clone https://github.com/seu-usuario/sistema-biblioteca.git
cd sistema-biblioteca
Instale as dependências para ambas as partes:

bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
⚙ Configuração
Crie um arquivo .env na pasta backend baseado no .env.example:

bash
cp backend/.env.example backend/.env
Configure as variáveis de ambiente no arquivo .env:

env
DATABASE_URL="postgresql://usuario:senha@localhost:5432/biblioteca?schema=public"
PORT=3000
MAILTRAP_USER=seu_usuario
MAILTRAP_PASS=sua_senha
🚀 Executando o Projeto
Opção 1: Rodar separadamente
Backend:

bash
cd backend
npm run dev
Frontend (em outro terminal):

bash
cd frontend
npm start
Opção 2: Rodar com um único comando
Instale o concurrently globalmente:

bash
npm install -g concurrently
Na raiz do projeto:

bash
npm run start:all
🛠 Comandos Úteis
Banco de Dados (Prisma):

bash
# Aplicar migrações
npx prisma migrate dev

# Gerar cliente Prisma
npx prisma generate

# Abrir Prisma Studio (interface visual)
npx prisma studio
Testes:

bash
# Rodar testes do backend
cd backend
npm test
Produção:

bash
# Build do frontend (se aplicável)
cd frontend
npm run build

# Iniciar backend em produção
cd ../backend
npm start
🌐 Acesso
Backend API: http://localhost:3000

Frontend: http://localhost:3001

Prisma Studio: http://localhost:5555

📦 Estrutura do Projeto
sistema-biblioteca/
├── backend/          # Código do servidor
│   ├── src/
│   ├── prisma/
│   └── ...
├── frontend/         # Aplicação web
│   ├── public/
│   ├── src/
│   └── ...
└── README.md
🔧 Troubleshooting
Problema: Erros de conexão com o banco de dados
Solução: Verifique se:

O PostgreSQL está rodando

As credenciais no .env estão corretas

As migrações foram aplicadas (npx prisma migrate dev)

Problema: Portas em conflito
Solução: Altere as portas no .env (backend) ou package.json (frontend)

📄 Licença
Este projeto está sob a licença MIT. Consulte o arquivo LICENSE para mais detalhes.
