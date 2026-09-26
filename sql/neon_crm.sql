-- Fase 6 — CRM nativo do BuscaCNAE
-- Migração aditiva e idempotente. Pré-requisitos: neon_users_auth.sql e neon_prospecting.sql.
--
-- Princípios:
--   * A empresa é a entidade central: o CRM guarda establishment_id e NUNCA copia
--     razão social, CNPJ, endereço ou CNAE (esses dados vivem só em establishments).
--   * Todo registro pertence a um workspace (organização). Nenhuma consulta do app
--     lê dados de CRM sem filtrar por workspace_id + associação do usuário.
--   * FKs compostas (workspace_id, id) garantem no banco que etapa, negócio, nota,
--     tarefa e contato de um workspace não se misturam com os de outro.
--   * O histórico (crm_activities) é somente-inserção.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Organização. Todo usuário ganha um workspace pessoal (is_personal) na primeira
-- visita ao CRM; equipes são workspaces adicionais com membros.
CREATE TABLE IF NOT EXISTS crm_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  owner_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No máximo um workspace pessoal por usuário (evita corrida na criação automática).
CREATE UNIQUE INDEX IF NOT EXISTS crm_workspaces_personal_unique
  ON crm_workspaces (owner_profile_id) WHERE is_personal;

CREATE TABLE IF NOT EXISTS crm_workspace_members (
  workspace_id UUID NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_members_profile ON crm_workspace_members (profile_id);

-- Pipeline configurável por workspace.
CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_crm_stages_workspace ON crm_pipeline_stages (workspace_id, position);

-- Pessoa de contato em uma empresa. Dado pessoal inserido pelo usuário (LGPD):
-- pertence ao workspace, referencia a empresa e pode ser excluído a qualquer momento.
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  job_title TEXT,
  email TEXT,
  phone TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_company ON crm_contacts (workspace_id, establishment_id);

-- Negócio (oportunidade). Um por empresa por workspace: a empresa é o centro do CRM.
CREATE TABLE IF NOT EXISTS crm_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE RESTRICT,
  stage_id UUID NOT NULL,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  title TEXT CHECK (title IS NULL OR length(title) <= 160),
  owner_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  primary_contact_id UUID,
  amount_cents BIGINT CHECK (amount_cents IS NULL OR amount_cents >= 0),
  expected_close_date DATE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'search', 'list', 'map', 'company', 'prospecting')),
  source_ref TEXT,
  lost_reason TEXT,
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, establishment_id),
  FOREIGN KEY (workspace_id, stage_id) REFERENCES crm_pipeline_stages (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, primary_contact_id) REFERENCES crm_contacts (workspace_id, id) ON DELETE SET NULL (primary_contact_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_deals_board ON crm_deals (workspace_id, stage_id, position);
CREATE INDEX IF NOT EXISTS idx_crm_deals_owner ON crm_deals (workspace_id, owner_profile_id);

CREATE TABLE IF NOT EXISTS crm_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  deal_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  author_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, deal_id) REFERENCES crm_deals (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crm_notes_deal ON crm_notes (workspace_id, deal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  deal_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
  assignee_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, deal_id) REFERENCES crm_deals (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_deal ON crm_tasks (workspace_id, deal_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assignee ON crm_tasks (workspace_id, assignee_profile_id, status);

-- Histórico somente-inserção. deal_id fica nulo se o negócio for excluído (o
-- registro "deal.deleted" continua auditável pela empresa).
CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
  establishment_id UUID REFERENCES establishments(id) ON DELETE SET NULL,
  actor_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN (
    'deal.created', 'deal.updated', 'deal.deleted', 'stage.changed', 'owner.changed',
    'note.created', 'task.created', 'task.completed', 'task.reopened',
    'contact.created', 'contact.linked', 'contact.deleted'
  )),
  payload JSONB NOT NULL DEFAULT '{}',
  happened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON crm_activities (workspace_id, deal_id, happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_company ON crm_activities (workspace_id, establishment_id, happened_at DESC);
