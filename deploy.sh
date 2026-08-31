#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# deploy.sh — Iniciar/reiniciar botTaller con PM2 en VPS
# ═══════════════════════════════════════════════════════════
set -e

echo "▶ Verificando node_modules..."
if [ ! -d "node_modules" ]; then
  echo "  Instalando dependencias..."
  npm install --production
fi

echo "▶ Verificando sintaxis..."
node -c server.js
node -c supabase-client.js
node -c kapso-client.js
echo "  ✓ Sintaxis OK"

echo "▶ Iniciando con PM2..."
pm2 start server.js \
  --name "botTaller" \
  --max-restarts 5 \
  --restart-delay 3000 \
  2>/dev/null || pm2 restart "botTaller" --update-env

echo "▶ Estado PM2:"
pm2 ls | grep botTaller

echo "▶ Health check:"
sleep 3
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${PORT:-3458}/ || echo "FAIL")
echo "  GET / → $HEALTH"

if [ "$HEALTH" = "200" ]; then
  echo "✅ botTaller está corriendo en puerto ${PORT:-3458}"
  pm2 save
else
  echo "❌ Health check falló. Revisa logs: pm2 logs botTaller"
  exit 1
fi
