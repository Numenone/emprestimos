@echo off
title Sistema de Biblioteca - Backend e Frontend
color 0A

:: Configuração de diretórios (ajuste conforme sua estrutura de pastas)
set BACKEND_DIR=backend
set FRONTEND_DIR=frontend
set BACKEND_COMMAND=npm run dev
set FRONTEND_COMMAND=npm start

:: Verifica se o Node.js está instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js não está instalado ou não está no PATH
    pause
    exit /b
)

:: Inicia o backend em uma nova janela
start "Backend" cmd /k "cd /d %BACKEND_DIR% && %BACKEND_COMMAND%"

:: Espera 5 segundos para o backend iniciar
timeout /t 5 >nul

:: Inicia o frontend em uma nova janela
start "Frontend" cmd /k "cd /d %FRONTEND_DIR% && %FRONTEND_COMMAND%"

echo Ambos backend e frontend estão sendo iniciados...
echo Verifique as janelas do console que foram abertas.
pause