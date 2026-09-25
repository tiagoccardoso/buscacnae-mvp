-- Fase 5 — Central de Prospecção BuscaCNAE
-- Migração aditiva. Empresas continuam em establishments; a prospecção só guarda
-- referências e metadados do usuário, evitando cópia do cadastro empresarial.

ALTER TABLE IF EXISTS saved_lead_lists
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS filter_spec JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS score_criteria JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS saved_establishments
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saved_establishments_stage_check'
  ) THEN
    ALTER TABLE saved_establishments
      ADD CONSTRAINT saved_establishments_stage_check
      CHECK (stage IN ('new', 'researching', 'qualified', 'lead', 'discarded'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS prospecting_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL CHECK (field_key IN ('domain', 'digital_presence')),
  value JSONB NOT NULL,
  source TEXT NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, establishment_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_prospecting_enrichments_profile
  ON prospecting_enrichments(profile_id, establishment_id);

CREATE INDEX IF NOT EXISTS idx_saved_establishments_prospecting_stage
  ON saved_establishments(profile_id, stage);

CREATE INDEX IF NOT EXISTS idx_saved_establishments_prospecting_tags
  ON saved_establishments USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_saved_lead_lists_prospecting_tags
  ON saved_lead_lists USING GIN(tags);
