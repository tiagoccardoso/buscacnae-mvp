-- Reversão de sql/neon_crm_gestao.sql.
-- SEGURA: aborta (sem apagar nada) se existir negócio arquivado ou evento de arquivamento.
-- Nesse caso, restaure os negócios pela interface (filtro "Arquivados" → Restaurar) antes.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM crm_deals WHERE archived_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM crm_activities WHERE type IN ('deal.archived', 'deal.restored')) THEN
    RAISE EXCEPTION 'Reversão abortada: existem negócios arquivados ou eventos de arquivamento.';
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

-- Índice único criado pela Fase 9 só quando a unicidade não existia (dado não é afetado).
DROP INDEX IF EXISTS saved_establishments_profile_establishment_uidx;
DROP INDEX IF EXISTS idx_crm_deals_archived;
DROP INDEX IF EXISTS idx_crm_deals_active;
ALTER TABLE crm_deals DROP COLUMN IF EXISTS archived_by;
ALTER TABLE crm_deals DROP COLUMN IF EXISTS archived_at;

COMMIT;
