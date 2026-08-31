/**
 * supabase-client.js
 * Cliente RAW REST para Supabase (compatible con keys sb_secret_).
 * Requisito del skill "supabase-raw-rest": con keys sb_secret_... no funciona
 * @supabase/supabase-js; se hacen requests directos a /rest/v1 con los headers
 * apikey + Authorization: Bearer <key>.
 */
const https = require('https');
const { URL } = require('url');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TABLE = 'bot_status';

/**
 * Request genérico a la REST API de Supabase.
 * @param {string} path   - parte después de /rest/v1/ (incluye query-string)
 * @param {string} method - GET | POST | PATCH | DELETE
 * @param {object|null} body - payload JSON (POST/PATCH)
 * @returns {Promise<object>} - parsed JSON response (array o objeto)
 */
function supabaseRequest(path, method = 'GET', body = null) {
  const url = new URL(SUPABASE_URL + '/rest/v1/' + path);

  const payload = body ? JSON.stringify(body) : null;
  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation, resolution=merge-duplicates',
    },
  };
  if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Consulta el estado del bot para un número de WhatsApp.
 * @param {string} telefono - raw `from` del webhook de Kapso
 * @returns {Promise<object|null>} - row o null si no existe (default = ACTIVO)
 */
async function getBotStatus(telefono) {
  try {
    const res = await supabaseRequest(
      TABLE + "?telefono=eq." + telefono + "&select=bot_active,paused_at"
    );
    if (res.status === 200 && Array.isArray(res.body) && res.body.length > 0) {
      return res.body[0];
    }
    return null; // no hay fila → default ON
  } catch (e) {
    console.error('[supabase] getBotStatus error:', e.message);
    return null;
  }
}

/**
 * Desactiva el bot para un número (upsert con merge-duplicates).
 * Usa Prefer: resolution=merge-duplicates → 200 con body vacío.
 * @param {string} telefono
 * @returns {Promise<boolean>}
 */
async function disableBot(telefono) {
  const body = {
    telefono,
    bot_active: false,
    paused_at: new Date().toISOString(),
  };
  try {
    const res = await supabaseRequest(
      TABLE + '?on_conflict=telefono&select=*',
      'POST',
      body
    );
    console.log('[supabase] disableBot', telefono, '->', res.status);
    return res.status === 200 || res.status === 201;
  } catch (e) {
    console.error('[supabase] disableBot error:', e.message);
    return false;
  }
}

/**
 * Reactiva el bot para un número (útil para pruebas).
 * @param {string} telefono
 */
async function enableBot(telefono) {
  const body = {
    telefono,
    bot_active: true,
    paused_at: null,
  };
  try {
    const res = await supabaseRequest(
      TABLE + '?on_conflict=telefono&select=*',
      'POST',
      body
    );
    console.log('[supabase] enableBot', telefono, '->', res.status);
    return res.status === 200 || res.status === 201;
  } catch (e) {
    console.error('[supabase] enableBot error:', e.message);
    return false;
  }
}

module.exports = {
  getBotStatus,
  disableBot,
  enableBot,
  supabaseRequest,
};
