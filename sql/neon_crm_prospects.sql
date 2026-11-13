-- Fase 8 — Prospects manuais, WhatsApp e histórico comercial no CRM
-- Migração ADITIVA e IDEMPOTENTE. Pré-requisito: sql/neon_crm.sql (PostgreSQL 15+).
-- Reversão: sql/neon_crm_prospects_rollback.sql (só funciona antes de existirem prospects manuais).
--
-- Decisões:
--   * Dado informado pelo usuário NÃO vai para establishments (base oficial de CNPJ).
--     Ele vive em crm_prospects, que pertence a um workspace.
--   * Um negócio referencia EXATAMENTE UM alvo: establishment_id (empresa da base)
--     OU prospect_id (cadastro manual). Nada de registros empresariais falsos.
--   * FKs compostas (workspace_id, prospect_id) mantêm o isolamento entre workspaces
--     garantido no banco, como no restante do CRM.
--   * O histórico continua somente-inserção; abrir o WhatsApp NÃO gera evento.

BEGIN;

-- ---------------------------------------------------------------------------
-- Prospect manual (empresa sem cadastro na base ou pessoa física)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('company', 'person')),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  trade_name TEXT CHECK (trade_name IS NULL OR length(trade_name) <= 160),
  -- Documento opcional, só dígitos/letras (CNPJ alfanumérico), validado no app.
  document_type TEXT CHECK (document_type IN ('cnpj', 'cpf')),
  document TEXT CHECK (document IS NULL OR document ~ '^[0-9A-Z]{11,14}$'),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN (
    'buscacnae', 'manual', 'referral', 'whatsapp', 'visit', 'phone', 'website', 'social', 'event', 'import', 'other'
  )),
  origin_detail TEXT CHECK (origin_detail IS NULL OR length(origin_detail) <= 160),
  segment TEXT CHECK (segment IS NULL OR length(segment) <= 120),
  city_name TEXT CHECK (city_name IS NULL OR length(city_name) <= 120),
  state_code TEXT CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
  address TEXT CHECK (address IS NULL OR length(address) <= 300),
  contact_name TEXT CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  contact_role TEXT CHECK (contact_role IS NULL OR length(contact_role) <= 120),
  -- Telefones guardados COMO DIGITADOS (não destrutivo); a normalização é feita na leitura.
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  whatsapp TEXT CHECK (whatsapp IS NULL OR length(whatsapp) <= 40),
  phone_secondary TEXT CHECK (phone_secondary IS NULL OR length(phone_secondary) <= 40),
  email TEXT CHECK (email IS NULL OR length(email) <= 254),
  website TEXT CHECK (website IS NULL OR length(website) <= 300),
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, id),
  CHECK ((document IS NULL) = (document_type IS NULL)),
  CHECK (document_type IS NULL OR (document_type = 'cpf' AND kind = 'person') OR (document_type = 'cnpj' AND kind = 'company'))
);

-- Um documento aparece no máximo uma vez por workspace (duplicidade por CNPJ/CPF).
CREATE UNIQUE INDEX IF NOT EXISTS crm_prospects_document_unique
  ON crm_prospects (workspace_id, document_type, document) WHERE document IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_prospects_workspace ON crm_prospects (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_prospects_email ON crm_prospects (workspace_id, lower(email)) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Negócio: empresa da base OU prospect manual
-- ---------------------------------------------------------------------------
ALTER TABLE crm_deals ALTER COLUMN establishment_id DROP NOT NULL;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS prospect_id UUID;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS next_contact_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_deals_prospect_fkey') THEN
    ALTER TABLE crm_deals ADD CONSTRAINT crm_deals_prospect_fkey
      FOREIGN KEY (workspace_id, prospect_id) REFERENCES crm_prospects (workspace_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_deals_one_target') THEN
    ALTER TABLE crm_deals ADD CONSTRAINT crm_deals_one_target CHECK (num_nonnulls(establishment_id, prospect_id) = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_deals_prospect_unique') THEN
    ALTER TABLE crm_deals ADD CONSTRAINT crm_deals_prospect_unique UNIQUE (workspace_id, prospect_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_deals_priority_check') THEN
    ALTER TABLE crm_deals ADD CONSTRAINT crm_deals_priority_check CHECK (priority IN ('low', 'normal', 'high'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_crm_deals_next_contact ON crm_deals (workspace_id, next_contact_at) WHERE next_contact_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Contatos: de uma empresa da base OU de um prospect manual
-- ---------------------------------------------------------------------------
ALTER TABLE crm_contacts ALTER COLUMN establishment_id DROP NOT NULL;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS prospect_id UUID;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS whatsapp TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_prospect_fkey') THEN
    ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_prospect_fkey
      FOREIGN KEY (workspace_id, prospect_id) REFERENCES crm_prospects (workspace_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_one_target') THEN
    ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_one_target CHECK (num_nonnulls(establishment_id, prospect_id) = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_whatsapp_length') THEN
    ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_whatsapp_length CHECK (whatsapp IS NULL OR length(whatsapp) <= 40);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_prospect ON crm_contacts (workspace_id, prospect_id) WHERE prospect_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Histórico: novos tipos (interações registradas pelo usuário, próximo contato,
-- cadastro/edição de prospect). Recria o CHECK com a lista ampliada.
-- ---------------------------------------------------------------------------
ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS prospect_id UUID;
-- FK composta: um evento do workspace A nunca aponta para prospect do workspace B.
-- CASCADE: ao excluir o prospect, os eventos dele (que podem citar dados pessoais) saem junto.
ALTER TABLE crm_activities DROP CONSTRAINT IF EXISTS crm_activities_prospect_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_activities_prospect_fkey') THEN
    ALTER TABLE crm_activities ADD CONSTRAINT crm_activities_prospect_fkey
      FOREIGN KEY (workspace_id, prospect_id) REFERENCES crm_prospects (workspace_id, id) ON DELETE CASCADE;
  END IF;
END;
$$;
ALTER TABLE crm_activities DROP CONSTRAINT IF EXISTS crm_activities_type_check;
ALTER TABLE crm_activities ADD CONSTRAINT crm_activities_type_check CHECK (type IN (
  'deal.created', 'deal.updated', 'deal.deleted', 'stage.changed', 'owner.changed',
  'note.created', 'task.created', 'task.completed', 'task.reopened',
  'contact.created', 'contact.linked', 'contact.deleted',
  'prospect.created', 'prospect.updated', 'interaction.logged', 'next_contact.scheduled'
));
CREATE INDEX IF NOT EXISTS idx_crm_activities_prospect ON crm_activities (workspace_id, prospect_id, happened_at DESC) WHERE prospect_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Modelos de mensagem do workspace (os modelos padrão vivem no código).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_crm_templates_workspace ON crm_message_templates (workspace_id, name);

COMMIT;
