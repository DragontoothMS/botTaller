@echo off
title botTaller - Server
color 0A
cls

echo.
echo ════════════════════════════════════════════════════════
echo   botTaller - Server (localhost:3458)
echo   ngrok corre por separado en background
echo ════════════════════════════════════════════════════════
echo.

REM ── 1. Kill process en puerto 3458 ──────────────────────
echo [1/3] Limpiando puerto 3458...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3458 ^| findstr LISTENING') do (
    echo   Matando PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=2" %%a in ('netstat -ano ^| findstr :3458 ^| findstr LISTENING') do (
    echo   Matando PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)
echo   Puerto 3458 libre.

REM ── 2. Instalar dependencias si falta node_modules ───────
echo [2/3] Verificando dependencias...
if not exist node_modules (
    echo   Instalando dependencias...
    call npm install --production
)

REM ── 3. Verificar .env ────────────────────────────────────
echo [3/3] Verificando configuracion...
echo   (revisa que .env tenga KAPSO_API_KEY, SUPABASE_KEY, etc.)

echo.
echo   Server:  http://localhost:3458
echo   Health:  http://localhost:3458/
echo.
echo   [Ctrl+C para detener]
echo.

REM ── Arrancar server.js ───────────────────────────────────
node server.js

echo.
echo Server detenido.
pause
