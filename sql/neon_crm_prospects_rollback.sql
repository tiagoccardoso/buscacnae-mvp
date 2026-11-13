-- Reversão de sql/neon_crm_prospects.sql.
-- SEGURA: aborta (sem apagar nada) se já existirem prospects manuais, contatos de
-- prospects, eventos dos novos tipos ou modelos de mensagem. Nesse caso, exporte/remova
-- esses dados conscientemente antes de reverter.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM crm_prospects)
     OR EXISTS (SELECT 1 FROM crm_deals WHERE prospect_id IS NOT NULL OR establishment_id IS NULL)
     OR EXISTS (SELECT 1 FROM crm_contacts WHERE prospect_id IS NOT NULL OR establishment_id IS NULL)
     OR EXISTS (SELECT 1 FROM crm_activities WHERE type IN ('prospect.created', 'prospect.updated', 'interaction.logged', 'next_contact.scheduled'))
     OR EXISTS (SELECT 1 FROM crm_message_templates) THEN
    RAISE EXCEPTION 'Reversão abortada: existem dados da Fase 8 (prospects, interações ou modelos).';
  END IF;
END;
$$;

DROP TABLE IF EXISTS crm_message_templates;

ALTER TABLE crm_activities DROP CONSTRAINT IF EXISTS crm_activities_type_check;
ALTER TABLE crm_activities ADD CONSTRAINT crm_activities_type_check CHECK (type IN (
  'deal.created', 'deal.updated', 'deal.deleted', 'stage.changed', 'owner.changed',
  'note.created', 'task.created', 'task.completed', 'task.reopened',
  'contact.created', 'contact.linked', 'contact.deleted'
));
ALTER TABLE crm_activities DROP CONSTRAINT IF EXISTS crm_activities_prospect_fkey;
ALTER TABLE crm_activities DROP COLUMN IF EXISTS prospect_id;

ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_whatsapp_length;
ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_one_target;
ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_prospect_fkey;
ALTER TABLE crm_contacts DROP COLUMN IF EXISTS whatsapp;
ALTER TABLE crm_contacts DROP COLUMN IF EXISTS prospect_id;
ALTER TABLE crm_contacts ALTER COLUMN establishment_id SET NOT NULL;

ALTER TABLE crm_deals DROP CONSTRAINT IF EXISTS crm_deals_priority_check;
ALTER TABLE crm_deals DROP CONSTRAINT IF EXISTS crm_deals_prospect_unique;
ALTER TABLE crm_deals DROP CONSTRAINT IF EXISTS crm_deals_one_target;
ALTER TABLE crm_deals DROP CONSTRAINT IF EXISTS crm_deals_prospect_fkey;
DROP INDEX IF EXISTS idx_crm_deals_next_contact;
ALTER TABLE crm_deals DROP COLUMN IF EXISTS next_contact_at;
ALTER TABLE crm_deals DROP COLUMN IF EXISTS priority;
ALTER TABLE crm_deals DROP COLUMN IF EXISTS prospect_id;
ALTER TABLE crm_deals ALTER COLUMN establishment_id SET NOT NULL;

DROP TABLE IF EXISTS crm_prospects;

COMMIT;
