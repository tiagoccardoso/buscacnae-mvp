-- Mantido por compatibilidade. Para a autenticação própria com a tabela users,
-- execute preferencialmente: sql/neon_users_auth.sql

ALTER TABLE IF EXISTS profiles
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx
  ON profiles (lower(email))
  WHERE email IS NOT NULL;
