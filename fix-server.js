// Script para agregar sendImage al server.js
var fs = require('fs');
var f = 'server.js';
var c = fs.readFileSync(f, 'utf8');

// 1. Agregar sendImage al require
c = c.replace(
  "const { sendMessage, markAsRead, randomDelay } = require('./kapso-client');",
  "const { sendMessage, sendImage, markAsRead, randomDelay } = require('./kapso-client');"
);

// Build newBlock line by line to avoid template literal issues
var lines = [];
lines.push("// ===========================================================================");
lines.push("// LÓGICA DEL BOT — 4 mensajes fijos + disable");
lines.push("// ===========================================================================");
lines.push("");
lines.push("/** URL pública de la imagen en Supabase Storage */");
lines.push("var IMAGE_URL = process.env.SUPABASE_URL +");
lines.push("  '/storage/v1/object/public/primer%20mensaje/primer%20mensaje.png';");
lines.push("");
lines.push("/**");
lines.push(" * Secuencia de 4 mensajes que se envía en la primera interacción.");
lines.push(" * Burbuja 1: imagen promocional (desde Supabase Storage)");
lines.push(" * Burbujas 2-4: texto informativo");
lines.push(" */");
lines.push("var FIRST_CONTACT_BUBBLES = [");
lines.push("  null, // Placeholder — burbuja 1 se envía como imagen");
lines.push("  '📍 *Ubicación 1:* Av. Principal #123, Zona Centro.\\nTenemos servicio de diagnóstico gratuito.',");
lines.push("  '📍 *Ubicación 2:* Calle Secundaria #456, Zona Norte.\\nCita previa por WhatsApp.',");
lines.push("  '🕐 *Horario:* Lunes a viernes 8:00 am – 7:00 pm.\\n¡Te esperamos!',");
lines.push("];");
lines.push("");
lines.push("/**");
lines.push(" * Envía los 4 mensajes fijos con delay entre cada uno.");
lines.push(" * Burbuja 1: imagen promocional → burbujas 2-4: texto.");
lines.push(" */");
lines.push("async function sendFirstContactMessages(to) {");
lines.push("  console.log('[server] Enviando first-contact (4 burbujas) a:', to);");
lines.push("");
lines.push("  for (var i = 0; i < FIRST_CONTACT_BUBBLES.length; i++) {");
lines.push("    var index = i + 1;");
lines.push("    try {");
lines.push("      var result;");
lines.push("      if (index === 1) {");
lines.push("        console.log('[server] Burbuja 1/4 (imagen) ->', to);");
lines.push("        result = await sendImage(to, IMAGE_URL, '¡Bienvenido al Taller Mecánico!');");
lines.push("      } else {");
lines.push("        console.log('[server] Burbuja ' + index + '/4 (texto) ->', to);");
lines.push("        result = await sendMessage(to, FIRST_CONTACT_BUBBLES[i]);");
lines.push("      }");
lines.push("      console.log('[server] Burbuja ' + index + ' enviada, status:', result.status);");
lines.push("    } catch (e) {");
lines.push("      console.error('[server] Error enviando burbuja ' + index + ':', e.message);");
lines.push("    }");
lines.push("");
lines.push("    if (i < FIRST_CONTACT_BUBBLES.length - 1) {");
lines.push("      await randomDelay(1500, 2500);");
lines.push("    }");
lines.push("  }");
lines.push("");
lines.push("  await disableBot(to);");
lines.push("  console.log('[server] Bot DESACTIVADO para:', to, '(primer contacto completado)');");
lines.push("}");
var newBlock = lines.join('\n');

// Find and replace
var startMarker = "// ===========================================================================";
var startIdx = c.indexOf(startMarker + "\n// LÓGICA DEL BOT");
var endIdx = c.indexOf(startMarker + "\n// MANEJO DE WEBHOOK", startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  c = c.substring(0, startIdx) + newBlock + "\n\n" + c.substring(endIdx);
  console.log("Bloque reemplazado");
} else {
  console.log("No se encontro el bloque. startIdx: " + startIdx + " endIdx: " + endIdx);
  process.exit(1);
}

fs.writeFileSync(f, c);
console.log("Archivo actualizado");

// Verify
var updated = fs.readFileSync(f, 'utf8');
if (updated.indexOf('sendImage') !== -1) {
  console.log("sendImage encontrado en server.js");
}
if (updated.indexOf('IMAGE_URL') !== -1) {
  console.log("IMAGE_URL encontrado en server.js");
}
