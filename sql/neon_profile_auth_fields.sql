-- Ajustes opcionais para garantir que a tabela operacional de usuários
-- tenha os campos necessários ao fluxo de login/cadastro com Neon Auth.
-- Execute no Neon somente se a tabela profiles ainda não possuir estes campos.

ALTER TABLE IF EXISTS profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx
  ON profiles (lower(email))
  WHERE email IS NOT NULL;

-- Observação de segurança:
-- A senha deve ser gerenciada pelo Neon Auth/Better Auth.
-- Não grave senha em texto puro na tabela profiles.
