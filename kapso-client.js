/**
 * kapso-client.js
 * Envío de mensajes: texto, imagen y tarjetas de ubicación.
 * Endpoint: POST https://api.kapso.ai/meta/whatsapp/v24.0/{PHONE_NUMBER_ID}/messages
 * Header: X-API-Key
 */
const https = require('https');
require('dotenv').config();

const KAPSO_API_KEY = process.env.KAPSO_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const KAPSO_HOST = 'api.kapso.ai';
const KAPSO_PATH = '/meta/whatsapp/v24.0/' + PHONE_NUMBER_ID + '/messages';

// ──────────────────────────────────────────────────────────────
// MARK AS READ + TYPING
// ──────────────────────────────────────────────────────────────

/**
 * Marca un mensaje como leído y opcionalmente envía typing indicator.
 * @param {string} messageId - wamid.XXXX de Kapso
 * @returns {Promise<object>} { status, body }
 */
function markAsRead(messageId) {
  if (!messageId) {
    return Promise.resolve({ status: 'skipped', body: { note: 'no message_id' } });
  }

  const payload = JSON.stringify({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
    typing_indicator: { type: 'text' },
  });

  var options = {
    hostname: KAPSO_HOST,
    path: KAPSO_PATH,
    method: 'POST',
    headers: {
      'X-API-Key': KAPSO_API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise(function (resolve) {
    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var parsed;
        try { parsed = data ? JSON.parse(data) : {}; } catch (e) { parsed = { raw: data }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', function (e) {
      console.error('[kapso] markAsRead error:', e.message);
      resolve({ status: 'error', body: { error: e.message } });
    });
    req.write(payload);
    req.end();
  });
}

// ──────────────────────────────────────────────────────────────
// MENSAJE DE TEXTO
// ──────────────────────────────────────────────────────────────

/**
 * Envía un mensaje de texto.
 * @param {string} to   - número con código de país (ej. 59171234567)
 * @param {string} text - cuerpo del mensaje
 * @returns {Promise<object>} { status, body }
 */
function sendMessage(to, text) {
  const payload = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'text',
    text: { body: text },
  });

  var options = {
    hostname: KAPSO_HOST,
    path: KAPSO_PATH,
    method: 'POST',
    headers: {
      'X-API-Key': KAPSO_API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise(function (resolve, reject) {
    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var parsed;
        try { parsed = data ? JSON.parse(data) : {}; } catch (e) { parsed = { raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: parsed });
        } else {
          console.error('[kapso] sendMessage error:', res.statusCode, data);
          resolve({ status: res.statusCode, body: parsed });
        }
      });
    });
    req.on('error', function (e) {
      console.error('[kapso] sendMessage network error:', e.message);
      reject(e);
    });
    req.setTimeout(10000, function () {
      console.error('[kapso] sendMessage timeout');
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(payload);
    req.end();
  });
}

// ──────────────────────────────────────────────────────────────
// MENSAJE DE IMAGEN
// ──────────────────────────────────────────────────────────────

/**
 * Envía una imagen (ej. promocional) con caption opcional.
 * @param {string} to
 * @param {string} imageUrl - URL pública HTTPS
 * @param {string} [caption]
 * @returns {Promise<object>} { status, body }
 */
function sendImage(to, imageUrl, caption) {
  if (caption === undefined) caption = '';
  var payload = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'image',
    image: { link: imageUrl, caption: caption },
  });

  var options = {
    hostname: KAPSO_HOST,
    path: KAPSO_PATH,
    method: 'POST',
    headers: {
      'X-API-Key': KAPSO_API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise(function (resolve) {
    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var parsed;
        try { parsed = data ? JSON.parse(data) : {}; } catch (e) { parsed = { raw: data }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', function (e) {
      console.error('[kapso] sendImage error:', e.message);
      resolve({ status: 'error', body: { error: e.message } });
    });
    req.write(payload);
    req.end();
  });
}

// ──────────────────────────────────────────────────────────────
// TARJETA DE UBICACIÓN (location message)
// ──────────────────────────────────────────────────────────────

/**
 * Envía una tarjeta de ubicación nativa de WhatsApp.
 *
 * Payload según API de Meta/Kapso:
 * {
 *   "to": phone_number,
 *   "type": "location",
 *   "location": {
 *     "latitude": <number>,
 *     "longitude": <number>,
 *     "name": "Nombre de la Sucursal",
 *     "address": "Dirección o referencia"
 *   }
 * }
 *
 * @param {string} to         - número con código de país (ej. 59171234567)
 * @param {number} latitude  - latitud decimal
 * @param {number} longitude - longitud decimal
 * @param {string} name      - nombre que aparece en la tarjeta
 * @param {string} address   - dirección o referencia
 * @returns {Promise<object>} { status, body }
 */
function sendKapsoLocation(to, latitude, longitude, name, address) {
  var payload = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'location',
    location: {
      latitude: latitude,
      longitude: longitude,
      name: name,
      address: address,
    },
  });

  var options = {
    hostname: KAPSO_HOST,
    path: KAPSO_PATH,
    method: 'POST',
    headers: {
      'X-API-Key': KAPSO_API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise(function (resolve) {
    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var parsed;
        try { parsed = data ? JSON.parse(data) : {}; } catch (e) { parsed = { raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: parsed });
        } else {
          console.error('[kapso] sendKapsoLocation error:', res.statusCode, data);
          resolve({ status: res.statusCode, body: parsed });
        }
      });
    });
    req.on('error', function (e) {
      console.error('[kapso] sendKapsoLocation network error:', e.message);
      resolve({ status: 'error', body: { error: e.message } });
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Extrae latitud y longitud de una URL de Google Maps.
 * Patrón: !3d(latitud)!4d(longitud)
 *   - !3d = latitud
 *   - !4d = longitud
 *
 * @param {string} url - URL de Google Maps
 * @returns {{latitude: number|null, longitude: number|null}}
 */
function extractCoordsFromGoogleMapsUrl(url) {
  if (!url || typeof url !== 'string') {
    return { latitude: null, longitude: null };
  }
  // El patrón !3d(-?\d+\.\d+)!4d(-?\d+\.\d+) captura lat y lng
  var match = url.match(/!3d(-?\d+\.\d+)!/);
  // El regex completo /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/ no funciona si hay
  // parámetros extra entre !3d y !4d, así que buscamos por separado.
  // Para !4d necesitamos el segundo match después de !4d.
  var latMatch = url.match(/!3d(-?\d+\.\d+)/);
  var lngMatch = url.match(/!4d(-?\d+\.\d+)/);

  var latitude = latMatch ? parseFloat(latMatch[1]) : null;
  var longitude = lngMatch ? parseFloat(lngMatch[1]) : null;

  return { latitude: latitude, longitude: longitude };
}

// ──────────────────────────────────────────────────────────────
// DELAY + UTILIDADES
// ──────────────────────────────────────────────────────────────

/** Delay aleatorio entre ms. */
function randomDelay(min, max) {
  if (min === undefined) min = 1500;
  if (max === undefined) max = 2000;
  var ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(function (r) { setTimeout(r, ms); });
}

module.exports = {
  sendMessage,
  sendImage,
  sendKapsoLocation,
  markAsRead,
  randomDelay,
  extractCoordsFromGoogleMapsUrl,
};
