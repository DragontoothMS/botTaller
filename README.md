# Bot de WhatsApp — botTaller

Bot de WhatsApp que responde con **4 mensajes fijos** en la primera interacción con un cliente, y luego se **apaga automáticamente** para ese número. El estado (encendido/apagado) se guarda en **Supabase** por número de WhatsApp, usando la **API de Kapso**.

## Arquitectura

```
WhatsApp → Kapso Webhook (POST /) → server.js
                                    ↓
                          getBotStatus(telefono)  ← Supabase
                                    ↓
                          [ACTIVO] ? → 4 burbujas → disableBot(telefono)
                          [DESACTIVADO] → ignora mensaje
```

## Archivos

| Archivo | Descripción |
|---|---|
| `server.js` | Servidor HTTP + handler del webhook |
| `kapso-client.js` | Envío de mensajes (text + image) vía Kapso API |
| `supabase-client.js` | Cliente RAW REST (compatible `sb_secret_...` keys) |
| `supabase-schema.sql` | DDL de la tabla `bot_status` |
| `.env.example` | Template de variables de entorno |

## Configuración

### 1. Variables de entorno

Copia `.env.example` a `.env` y completa:

```bash
KAPSO_API_KEY=           # Tu X-API-Key de Kapso (dashboard.kapso.ai)
PHONE_NUMBER_ID=         # Phone Number ID de Meta/Kapso
SUPABASE_URL=            # https://hwxtrfkqbqwwpmresdtw.supabase.co
SUPABASE_KEY=            # sb_secret_... (service_role key)
PORT=3458                # Puerto del servidor
```

### 2. Tabla en Supabase

Ejecuta `supabase-schema.sql` en el **SQL Editor** de tu proyecto Supabase:

```sql
-- Copia y ejecuta el contenido de supabase-schema.sql
```

## Cómo funciona

1. **Primer mensaje** del cliente → Kapso envía webhook a `POST /`
2. El bot consulta `getBotStatus(telefono)` en Supabase
3. **Si no hay fila** (primera vez) o `bot_active !== false`:
   - Envía 4 burbujas con delay de 1.5–2.5s entre cada una
   - Al final, hace `disableBot(telefono)` (upsert con `bot_active=false`)
4. **Si hay fila con `bot_active=false`**: ignora el mensaje

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET /` | Health check | `{"status":"ok","bot":"botTaller"}` |
| `POST /` | Webhook de Kapso | Recibe y procesa mensajes entrantes |
| `POST /webhook` | Alias del webhook | Same handler |
| `POST /test` | Simular webhook | `{"from":"591...","text":"hola"}` → debug local |
| `POST /debug/enable` | Reactivar bot | `{"telefono":"591..."}` → `bot_active=true` |

## Uso local con ngrok (webhook público)

El dominio ngrok ya provisionado es:
```
https://hungerless-uncrystalled-andy.ngrok-free.dev
```

### Opción 1: Script de inicio (recomendado)

```bash
# Inicia server + ngrok en un solo comando
node start-ngrok.js
```

El script abre ngrok hacia `localhost:3458` y verifica que ngrok esté conectado
antes de iniciar el servidor HTTP. Luego configura Kapso webhook vía API.

### Opción 2: Manual

```bash
# Terminal 1 — ngrok
ngrok http 3458 --domain=hungerless-uncrystalled-andy.ngrok-free.dev

# Terminal 2 — server
node server.js
```

El webhook público para Kapso es:
```
https://hungerless-uncrystalled-andy.ngrok-free.dev/
```

> **Nota:** Kapso requiere HTTPS para webhooks. ngrok proporciona el
> certificado TLS automáticamente.

### Configurar el webhook en Kapso

Una vez que ngrok esté corriendo, registra el webhook en Kapso:
```bash
curl -X POST "https://api.kapso.ai/v1/webhooks" \
  -H "X-API-Key: $KAPSO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://hungerless-uncrystalled-andy.ngrok-free.dev/",
    "events": ["message_received", "message_status_update"]
  }'
```

Verifica:
```bash
curl -X GET "https://api.kapso.ai/v1/webhooks" \
  -H "X-API-Key: $KAPSO_API_KEY"
```

### Simular webhook localmente (debug)

```bash
# Simular un mensaje entrante (debug local, no requiere credenciales reales)
curl -X POST http://localhost:3458/test \
  -H 'Content-Type: application/json' \
  -d '{"from":"59162077532","text":"hola"}'

# Reactivar un número después del primer contacto
curl -X POST http://localhost:3458/debug/enable \
  -H 'Content-Type: application/json' \
  -d '{"telefono":"59162077532"}'
```

## Despliegue en VPS

```bash
# 1. Subir archivos al VPS
# 2. Instalar dependencias
npm install --production

# 3. Crear tabla en Supabase (SQL Editor)
#    Ejecuta supabase-schema.sql

# 4. Configurar .env en el VPS
cp .env.example .env
# Edita con las credenciales reales

# 5. Deploy + PM2
pm2 start server.js --name botTaller --max-restarts 5
pm2 save
pm2 startup
```

## Personalización de las 4 burbujas

Edita el arreglo `FIRST_CONTACT_BUBBLES` en `server.js`:

```javascript
const FIRST_CONTACT_BUBBLES = [
  '¡Hola! Bienvenido al Taller Mecánico. 🚗🔧',           // Burbuja 1
  '📍 *Ubicación 1:* Av. Principal #123, Zona Centro.',    // Burbuja 2
  '📍 *Ubicación 2:* Calle Secundaria #456, Zona Norte.',  // Burbuja 3
  '🕐 *Horario:* Lunes a viernes 8:00 am – 7:00 pm.',      // Burbuja 4
];
```

## Troubleshooting

| Síntoma | Causa | Fix |
|---|---|---|
| `401 Authorization header missing` | `KAPSO_API_KEY` vacía o incorrecta | Completa `.env` |
| `getaddrinfo ENOTFOUND` | `SUPABASE_URL` / `SUPABASE_KEY` vacíos | Completa `.env` |
| `422 Cannot send non-template messages` | Fuera de la ventana de 24h | El cliente debe escribir primero |
| Bot ignora mensajes | `bot_active=false` para ese número | Reinicia con `/debug/enable` |
