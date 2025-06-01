###Sistema de Biblioteca - Backend + Frontend###
####Este projeto é um sistema de gerenciamento de biblioteca com backend em Node.js/Express e frontend web.####

📋 Pré-requisitos
Node.js v16+

npm v8+

Banco de dados PostgreSQL

Git (opcional)


DATABASE_URL="postgresql://usuario:senha@localhost:5432/biblioteca?schema=public"
PORT=3000
MAILTRAP_USER=seu_usuario
MAILTRAP_PASS=sua_senha

# Aplicar migrações
npx prisma migrate dev

# Gerar cliente Prisma
npx prisma generate

# Abrir Prisma Studio (interface visual)
npx prisma studio

NPM RUN DEV
NPX TS-NODE SRC/SERVER.TS


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

📄 Licença
Este projeto está sob a licença MIT. Consulte o arquivo LICENSE para mais detalhes.
