-- Bot Army module 1: synthetic bot lifecycle columns on public.users (never auto-deleted).
-- Idempotent: safe to run more than once.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_status text NOT NULL DEFAULT 'sleeping',
  ADD COLUMN IF NOT EXISTS bot_persona text;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_bot_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_bot_status_check
  CHECK (bot_status IN ('active', 'sleeping'));

CREATE INDEX IF NOT EXISTS idx_users_synthetic_status
  ON public.users (is_synthetic, bot_status)
  WHERE is_synthetic = true;

COMMIT;
