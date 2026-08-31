/**
 * server.js — Bot de WhatsApp para taller mecánico
 *
 * COMPORTAMIENTO:
 * - Responde SOLO al primer mensaje del cliente con:
 *   1. Imagen promocional (Supabase Storage)
 *   2. Tarjeta de ubicación (Sucursal Santos Inyectores)
 *   3. Tarjeta de ubicación (Sucursal MOTORES & MOTORES)
 *   4. Mensaje de texto informativo
 * - Después de las 4 burbujas, se apaga (DISABLED) para ese número
 * - El estado (encendido/apagado) se guarda en Supabase (tabla bot_status)
 * - Si el bot está apagado para ese número, ignora todos los mensajes
 *   (sin markAsRead ni typing indicator — evita confusión visual)
 *
 * Stack:
 *   - Kapso API (https://api.kapso.ai) para envío de mensajes
 *   - Supabase raw REST para persistencia de estado
 *
 * Webhook de Kapso: POST /  →  {message:{from:...}, conversation:{...}}
 *   o Legacy: {entry:[{changes:[{value:{messages:[{from:...}}]}}]}]}
 */
var http = require('http');
var https = require('https');
require('dotenv').config();

var supabase = require('./supabase-client');
var kapso = require('./kapso-client');

var PORT = process.env.PORT || 3458;
var PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ──────────────────────────────────────────────────────────────
// UTILIDADES
// ──────────────────────────────────────────────────────────────

/** Extrae el número de teléfono del cliente del webhook de Kapso.
 *  Soporta varios formatos de payload:
 *   - message.from            (formato real Kapso v2 — flat)
 *   - conversation.phone_number (fallback v2)
 *   - entry[].changes[].value.messages[].from  (legacy)
 *   - contacts[0].wa_id         (legacy fallback)
 */
function extractPhone(entry, rawBody) {
  try {
    // --- Formato REAL de Kapso v2 (flat) ---
    if (rawBody) {
      var payload = JSON.parse(rawBody);
      // message.from (formato Kapso v2)
      if (payload.message && payload.message.from) {
        return normalizeFrom(payload.message.from);
      }
      // conversation.phone_number (fallback)
      if (payload.conversation && payload.conversation.phone_number) {
        return normalizeFrom(payload.conversation.phone_number);
      }
    }

    // --- Formato legacy (entry[].changes[].value.messages[].from) ---
    if (Array.isArray(entry) && entry.length > 0) {
      var value = entry[0].changes && entry[0].changes[0] && entry[0].changes[0].value;
      if (value) {
        // 1. messages[0].from
        var messages = value.messages || [];
        if (messages.length > 0 && messages[0].from) {
          return normalizeFrom(messages[0].from);
        }
        // 2. contacts[0].wa_id
        var contacts = value.contacts || [];
        if (contacts.length > 0 && contacts[0].wa_id) {
          return normalizeFrom(contacts[0].wa_id);
        }
      }
      // 3. Fallback: buscar en messages sin estructura anidada estricta
      for (var i = 0; i < entry.length; i++) {
        var changes = entry[i].changes || [];
        for (var j = 0; j < changes.length; j++) {
          var msg = changes[j].value && changes[j].value.messages && changes[j].value.messages[0];
          if (msg && msg.from) return normalizeFrom(msg.from);
        }
      }
    }
  } catch (e) {
    console.error('[server] extractPhone error:', e.message);
  }
  return '';
}

/** Normaliza el número: strip 'waid:', '+', espacios. */
function normalizeFrom(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .toString()
    .replace(/^waid:/, '')   // "waid:59162077532" → "59162077532"
    .replace(/^[^0-9]/g, '') // strip leading '+', '-', etc.
    .replace(/[^\d]/g, '')   // keep only digits
    .trim();
}

/** Extrae el message_id para marcar como leído. */
function extractMessageId(entry) {
  try {
    var messages = entry[0].changes && entry[0].changes[0] && entry[0].changes[0].value && entry[0].changes[0].value.messages || [];
    if (messages.length > 0) return messages[0].id || '';
  } catch (e) {}
  return '';
}

// ──────────────────────────────────────────────────────────────
// SUCURSALES — coordenadas extraídas de Google Maps URLs
// ──────────────────────────────────────────────────────────────

// URLs de Google Maps de las sucursales
var SUCURSALES = [
  {
    name: 'Santos Inyectores',
    googleMapsUrl: 'https://www.google.com/maps/place/Santos+Inyectores/@-17.8253379,-63.2274163,726m/data=!3m1!1e3!4m6!3m5!1s0x93f1c3701a5f0361:0x60505e9ad012eb61!8m2!3d-17.8253379!4d-63.2248414!16s%2Fg%2F11k9j_yty8',
    address: 'Santa Cruz de la Sierra, BO',
  },
  {
    name: 'MOTORES & MOTORES',
    googleMapsUrl: 'https://www.google.com/maps/place/MOTORES+%26+MOTORES/@-17.8079371,-63.205947,726m/data=!3m1!1e3!4m10!1m2!2m1!1sMotores+y+Motores!3m6!1s0x93f1e9de7ebb19c7:0x9fa556bbacaf813a!8m2!3d-17.8079417!4d-63.2014463!15sChFNb3RvcmVzIHkgTW90b3Jlc5IBEWF1dG9fbWFjaGluZV9zaG9w4AEA!16s%2Fg%2F11ghrf_w3q',
    address: 'Santa Cruz de la Sierra, BO',
  },
];

// Extraer coordenadas mediante regex (!3d = lat, !4d = lng)
var SUCURSAL_COORDS = SUCURSALES.map(function (s) {
  var coords = kapso.extractCoordsFromGoogleMapsUrl(s.googleMapsUrl);
  console.log('[server] Sucursal:', s.name, '->', coords);
  return Object.assign({}, s, coords);
});

// URL de la imagen promocional en Supabase Storage
var IMAGE_URL = process.env.SUPABASE_URL +
  '/storage/v1/object/public/primer%20mensaje/primer%20mensaje.png';

// Mensaje texto para la 4ta burbuja
var BUBBLE_4_TEXT = 'De 8am hasta las 7 pm de lunes a sábado en horario continuo todo los días';

// ──────────────────────────────────────────────────────────────
// LÓGICA DEL BOT
// ──────────────────────────────────────────────────────────────

/**
 * Envía los 4 mensajes fijos con delay entre cada uno:
 *   1. Imagen promocional (Supabase Storage)
 *   2. Tarjeta de ubicación — Sucursal Santos Inyectores
 *   3. Tarjeta de ubicación — Sucursal MOTORES & MOTORES
 *   4. Texto informativo
 * Luego desactiva el bot para ese número.
 *
 * @param {string} to - número de WhatsApp del cliente
 * @returns {Promise<void>}
 */
async function sendFirstContactMessages(to) {
  console.log('[server] Enviando first-contact (4 burbujas) a:', to);
  var results = [];

  // 1. Imagen promocional (sin caption)
  console.log('[server] Burbuja 1/4 (imagen) ->', to);
  var imgRes = await kapso.sendImage(to, IMAGE_URL, '');
  console.log('[server] Burbuja 1 enviada, status:', imgRes.status);
  results.push(imgRes);
  await kapso.randomDelay(1500, 2500);

  // 2. Tarjeta de ubicación — Sucursal 1
  var s1 = SUCURSAL_COORDS[0];
  console.log('[server] Burbuja 2/4 (ubicación:' + s1.name + ') ->', to);
  var locRes1 = await kapso.sendKapsoLocation(
    to, s1.latitude, s1.longitude, s1.name, s1.address
  );
  console.log('[server] Burbuja 2 enviada, status:', locRes1.status);
  results.push(locRes1);
  await kapso.randomDelay(1500, 2500);

  // 3. Tarjeta de ubicación — Sucursal 2
  var s2 = SUCURSAL_COORDS[1];
  console.log('[server] Burbuja 3/4 (ubicación:' + s2.name + ') ->', to);
  var locRes2 = await kapso.sendKapsoLocation(
    to, s2.latitude, s2.longitude, s2.name, s2.address
  );
  console.log('[server] Burbuja 3 enviada, status:', locRes2.status);
  results.push(locRes2);
  await kapso.randomDelay(1500, 2500);

  // 4. Texto informativo
  console.log('[server] Burbuja 4/4 (texto) ->', to);
  var txtRes = await kapso.sendMessage(to, BUBBLE_4_TEXT);
  console.log('[server] Burbuja 4 enviada, status:', txtRes.status);
  results.push(txtRes);

  // Desactivar el bot para este número en Supabase
  await supabase.disableBot(to);
  console.log('[server] Bot DESACTIVADO para:', to, '(primer contacto completado)');

  return results;
}

// ──────────────────────────────────────────────────────────────
// MANEJO DE WEBHOOK — handler principal
// ──────────────────────────────────────────────────────────────

/**
 * Procesa un mensaje entrante de Kapso.
 * - Si es primera interacción: envía 4 burbujas → desactiva bot
 * - Si el bot está desactivado para ese número: ignora el mensaje
 *   (SIN markAsRead ni typing indicator)
 *
 * @param {string} from - número de WhatsApp del cliente
 * @param {string} messageId - wamid.XXXX para marcar como leído
 */
async function handleIncomingMessage(from, messageId) {
  if (!from) {
    console.warn('[server] Mensaje sin número de teléfono, ignorado.');
    return;
  }

  // 1. Consultar estado del bot en Supabase PRIMERO
  var status = await supabase.getBotStatus(from);

  if (status && status.bot_active === false) {
    // Bot DESACTIVADO para este número → NO marcar como read, NO typing
    console.log('[server] Bot DESACTIVADO para:', from, '→ mensaje ignorado (sin read ni typing).');
    return;
  }

  if (status && status.bot_active === true) {
    console.log('[server] Bot ACTIVO para:', from, '→ reactivando secuencia 4 burbujas.');
  } else {
    console.log('[server] Sin estado previo para:', from, '→ primera interacción detectada.');
  }

  // 2. Marcar como leído + typing SOLO si el bot está activo
  if (messageId) {
    kapso.markAsRead(messageId).catch(function (e) {
      console.error('[server] markAsRead falló:', e.message);
    });
  }

  // 3. Enviar 4 burbujas y desactivar
  await sendFirstContactMessages(from);
}

// ──────────────────────────────────────────────────────────────
// SERVIDOR HTTP
// ──────────────────────────────────────────────────────────────

var server = http.createServer(function (req, res) {
  // Ruta de salud
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      bot: 'botTaller',
      description: '4-mensaje first-contact (imagen + 2 location + texto) con disable por chat',
    }));
    return;
  }

  // Webhook de Kapso: POST /
  if (req.method === 'POST' && (req.url === '/' || req.url === '/webhook')) {
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      // Responder rápido 200 a Kapso
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true }));

      // Procesar asíncronamente
      try {
        // Filtrar eventos que NO son mensajes nuevos
        var webhookEvent = req.headers['x-webhook-event'] || '';
        var skipEvents = [
          'whatsapp.message.sent',
          'whatsapp.message.delivered',
          'whatsapp.message.read',
          'whatsapp.conversation.created',
          'whatsapp.conversation.ended',
          'whatsapp.conversation.inactive',
          'whatsapp.contact.identity_changed',
          'whatsapp.contact.marketing_preference_changed',
        ];
        if (webhookEvent && skipEvents.indexOf(webhookEvent) !== -1) {
          console.log('[webhook] Evento ignorado:', webhookEvent);
          return;
        }

        var payload = JSON.parse(body);

        // Extract phone number — Kapso v2 (flat) o legacy (nested)
        var from = extractPhone(payload.entry || [], body);
        var messageId = '';
        if (payload.message && payload.message.id) {
          messageId = payload.message.id;
        } else {
          messageId = extractMessageId(payload.entry || []);
        }

        console.log('[webhook] Mensaje entrante de:', from, '| id:', messageId);

        // Procesar mensaje (async, no await en el handler)
        handleIncomingMessage(from, messageId);
      } catch (e) {
        console.error('[webhook] Error procesando payload:', e.message);
        console.error('[webhook] Body:', body.substring(0, 200));
      }
    });
    return;
  }

  // Endpoint de debug: reactivar un número
  if (req.method === 'POST' && req.url === '/debug/enable') {
    var body2 = '';
    req.on('data', function (chunk) { body2 += chunk; });
    req.on('end', async function () {
      try {
        var telefono = JSON.parse(body2).telefono;
        if (!telefono) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Se requiere { "telefono": "591..." }' }));
          return;
        }
        await supabase.enableBot(telefono);
        console.log('[debug] Bot REACTIVADO para:', telefono);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, telefono: telefono, action: 'enabled' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Endpoint para simular webhook localmente (debug)
  if (req.method === 'POST' && req.url === '/test') {
    var body3 = '';
    req.on('data', function (chunk) { body3 += chunk; });
    req.on('end', async function () {
      try {
        var parsed = JSON.parse(body3);
        var from = parsed.from;
        var text = parsed.text;
        // Simular formato REAL de Kapso v2 (flat payload)
        var fakePayload = {
          message: {
            id: 'test-msg-' + Date.now(),
            from: from,
            type: 'text',
            text: { body: text || 'hola' },
          },
          conversation: {
            phone_number: from,
            phone_number_id: PHONE_NUMBER_ID || '123456789',
          },
          is_new_conversation: true,
          phone_number_id: PHONE_NUMBER_ID || '123456789',
        };
        var phone = extractPhone([], JSON.stringify(fakePayload));
        var msgId = fakePayload.message.id;
        await handleIncomingMessage(phone, msgId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          processed: true,
          from: phone,
          bubbles_sent: 4,
          types: ['image', 'location', 'location', 'text'],
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, function () {
  console.log('=========================================');
  console.log('  botTaller — Bot de WhatsApp');
  console.log('  Puerto: ' + PORT);
  console.log('  Kapso Phone ID: ' + PHONE_NUMBER_ID);
  console.log('  Supabase: ' + process.env.SUPABASE_URL);
  console.log('  Image URL: ' + IMAGE_URL);
  console.log('=========================================');
  console.log('');
  console.log('Rutas:');
  console.log('  GET  /           → health check');
  console.log('  POST /           → webhook de Kapso');
  console.log('  POST /webhook    → webhook de Kapso (alias)');
  console.log('  POST /test       → simular webhook (debug)');
  console.log('  POST /debug/enable {telefono} → reactivar bot (debug)');
  console.log('');
  console.log('Estado de variables de entorno:');
  console.log('  KAPSO_API_KEY:', process.env.KAPSO_API_KEY ? 'configurada' : 'FALTA');
  console.log('  PHONE_NUMBER_ID:', PHONE_NUMBER_ID ? 'configurado' : 'FALTA');
  console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? 'OK' : 'FALTA');
  console.log('  SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'configurada' : 'FALTA');
  console.log('');
});
