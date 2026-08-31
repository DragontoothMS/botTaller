-- ═══════════════════════════════════════════════════════════
-- SQL:tabla bot_status
-- Base de datos: Supabase (proyecto: hwxtrfkqbqwwpmresdtw)
-- ═══════════════════════════════════════════════════════════

-- Crear la tabla que almacena el estado ACTIVO/DESACTIVADO del bot
-- para cada número de WhatsApp (por chat/conversación).
CREATE TABLE IF NOT EXISTS public.bot_status (
  -- Número de WhatsApp en formato raw (sin +, sin waid:), ej. "59171234567"
  -- Viene directamente del campo `from` del webhook de Kapso.
  telefono     text PRIMARY KEY,

  -- true  → el bot puede responder (primera interacción o reactivado manualmente)
  -- false → el bot está DESACTIVADO para este número (después de las 4 burbujas)
  bot_active   boolean DEFAULT true NOT NULL,

  -- Timestamp de cuándo se pausó/reactivó el bot
  paused_at     timestamptz,

  -- Timestamp de creación/registro
  created_at    timestamptz DEFAULT now() NOT NULL,

  -- Timestamp de última actualización
  updated_at    timestamptz DEFAULT now() NOT NULL
);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_bot_status_updated_at ON public.bot_status;
CREATE TRIGGER touch_bot_status_updated_at
  BEFORE UPDATE ON public.bot_status
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ──────────────────────────────────────────────────────────
-- RLS (Row Level Security) — opcional pero recomendado
-- ──────────────────────────────────────────────────────────
-- El bot_status se lee/escribe desde el servidor Node.js (no desde el cliente).
-- Si prefieres mantener RLS activo, usa la service_role key (sb_secret_...)
-- que ya configuras en .env → SUPABASE_KEY.

ALTER TABLE public.bot_status ENABLE ROW LEVEL SECURITY;

-- Política: permitir SELECT/INSERT/UPDATE con la service_role key (sb_secret_...)
CREATE POLICY "Service role full access" ON public.bot_status
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
