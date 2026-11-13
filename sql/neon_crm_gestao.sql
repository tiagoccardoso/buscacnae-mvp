-- Fase 9 — Gestão de prospects no CRM (arquivamento, exclusão em lote, CRM ↔ leads salvos)
-- Migração ADITIVA e IDEMPOTENTE. Pré-requisitos: sql/neon_crm.sql e sql/neon_crm_prospects.sql.
-- Nenhum dado existente é alterado ou removido.
--
-- Decisões:
--   * Arquivar ≠ excluir. Arquivar só marca o negócio (archived_at) e o tira da listagem padrão;
--     histórico, notas, tarefas, contatos e o prospect manual continuam intactos e o negócio
--     pode ser restaurado. Excluir continua sendo a remoção definitiva já existente.
--   * Nenhuma tabela nova: "leads salvos" continua sendo saved_establishments (por usuário) e o
--     CRM continua referenciando a empresa por establishment_id. A integração grava só o vínculo
--     (profile_id, establishment_id), sem copiar dados cadastrais.

BEGIN;

ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Listagem padrão (ativos) e filtro "Arquivados".
CREATE INDEX IF NOT EXISTS idx_crm_deals_active ON crm_deals (workspace_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_deals_archived ON crm_deals (workspace_id, archived_at DESC) WHERE archived_at IS NOT NULL;

-- Histórico: eventos de arquivamento/restauração.
ALTER TABLE crm_activities DROP CONSTRAINT IF EXISTS crm_activities_type_check;
ALTER TABLE crm_activities ADD CONSTRAINT crm_activities_type_check CHECK (type IN (
  'deal.created', 'deal.updated', 'deal.deleted', 'stage.changed', 'owner.changed',
  'note.created', 'task.created', 'task.completed', 'task.reopened',
  'contact.created', 'contact.linked', 'contact.deleted',
  'prospect.created', 'prospect.updated', 'interaction.logged', 'next_contact.scheduled',
  'deal.archived', 'deal.restored'
));

-- Deduplicação dos leads salvos: o envio ao CRM grava (profile_id, establishment_id) com
-- ON CONFLICT DO NOTHING. As actions já usam onConflict nessas colunas, então a unicidade
-- costuma existir; aqui ela é GARANTIDA quando faltar. Nunca apaga dados: se houver
-- duplicatas antigas, só avisa (NOTICE) e não cria o índice.
DO $$
BEGIN
  IF to_regclass('public.saved_establishments') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid AND t.relname = 'saved_establishments'
     WHERE i.indisunique
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM pg_attribute a
             WHERE a.attrelid = t.oid AND a.attnum = ANY(i.indkey)) = ARRAY['establishment_id', 'profile_id']
  ) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM saved_establishments GROUP BY profile_id, establishment_id HAVING count(*) > 1) THEN
    RAISE NOTICE 'saved_establishments tem duplicatas (profile_id, establishment_id); índice único não criado. Revise antes de reaplicar.';
    RETURN;
  END IF;
  CREATE UNIQUE INDEX saved_establishments_profile_establishment_uidx ON saved_establishments (profile_id, establishment_id);
END;
$$;

COMMIT;
