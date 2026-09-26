-- Fase 7 — Busca Empresarial Avançada: fila de sincronização do índice de pesquisa.
--
-- O índice (Meilisearch) é SÓ mecanismo de pesquisa. A verdade continua em `establishments`
-- (que por sua vez vem da Casa dos Dados). Esta migração cria:
--   1. search_index_outbox  — fila transacional: toda mudança relevante enfileira o CNPJ
--      NA MESMA transação da escrita (nada se perde se o índice estiver fora do ar);
--   2. search_index_state   — última sincronização, erros e contadores (monitoramento);
--   3. gatilhos em establishments e nas tabelas que definem QUEM pode ver a empresa
--      (lista liberada, empresas salvas, CRM).
-- Idempotente: pode ser executada mais de uma vez. Depende de sql/neon_users_auth.sql e,
-- se existirem, de sql/neon_prospecting.sql e sql/neon_crm.sql (gatilhos criados só se a tabela existir).

CREATE TABLE IF NOT EXISTS search_index_outbox (
  id BIGSERIAL PRIMARY KEY,
  establishment_id UUID,
  cnpj TEXT NOT NULL,
  reason TEXT NOT NULL,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_index_outbox_cnpj ON search_index_outbox (cnpj);

CREATE TABLE IF NOT EXISTS search_index_state (
  index_uid TEXT PRIMARY KEY,
  last_sync_at TIMESTAMPTZ,
  last_full_reindex_at TIMESTAMPTZ,
  last_purge_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  documents_upserted BIGINT NOT NULL DEFAULT 0,
  documents_deleted BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1) Mudança no próprio estabelecimento (dados cadastrais ou nova consulta detalhada).
CREATE OR REPLACE FUNCTION search_index_enqueue_establishment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO search_index_outbox (establishment_id, cnpj, reason) VALUES (OLD.id, OLD.cnpj, 'establishment_delete');
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.cnpj IS DISTINCT FROM OLD.cnpj AND OLD.cnpj IS NOT NULL THEN
    INSERT INTO search_index_outbox (establishment_id, cnpj, reason) VALUES (OLD.id, OLD.cnpj, 'establishment_cnpj_change');
  END IF;
  IF NEW.cnpj IS NOT NULL THEN
    INSERT INTO search_index_outbox (establishment_id, cnpj, reason) VALUES (NEW.id, NEW.cnpj, 'establishment_' || lower(TG_OP));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_search_index_establishments ON establishments;
CREATE TRIGGER trg_search_index_establishments
  AFTER INSERT OR DELETE OR UPDATE OF
    cnpj, company_name, trade_name, registration_status, opened_at, primary_cnae_code, primary_cnae_description,
    secondary_cnaes, company_size, state_code, city_name, city_ibge, provider_payload
  ON establishments
  FOR EACH ROW EXECUTE FUNCTION search_index_enqueue_establishment();

-- 2) Visibilidade: a empresa passa a (ou deixa de) aparecer para alguém.
CREATE OR REPLACE FUNCTION search_index_enqueue_by_establishment_id(target UUID, why TEXT) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO search_index_outbox (establishment_id, cnpj, reason)
  SELECT e.id, e.cnpj, why FROM establishments e WHERE e.id = target AND e.cnpj IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION search_index_enqueue_saved() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM search_index_enqueue_by_establishment_id(OLD.establishment_id, 'saved_delete');
    RETURN OLD;
  END IF;
  PERFORM search_index_enqueue_by_establishment_id(NEW.establishment_id, 'saved_' || lower(TG_OP));
  RETURN NEW;
END;
$$;

-- Pedido liberado (paid/free) ou revertido: todas as empresas daquela busca mudam de visibilidade.
CREATE OR REPLACE FUNCTION search_index_enqueue_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  was_unlocked BOOLEAN := TG_OP = 'UPDATE' AND OLD.status IN ('paid', 'free');
  is_unlocked BOOLEAN := NEW.status IN ('paid', 'free');
BEGIN
  IF was_unlocked IS DISTINCT FROM is_unlocked AND NEW.search_query_id IS NOT NULL THEN
    INSERT INTO search_index_outbox (establishment_id, cnpj, reason)
    SELECT DISTINCT e.id, e.cnpj, CASE WHEN is_unlocked THEN 'order_unlocked' ELSE 'order_locked' END
      FROM search_results sr
      JOIN establishments e ON e.id = sr.establishment_id
     WHERE sr.search_query_id = NEW.search_query_id AND e.cnpj IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Resultado gravado depois de o pedido já estar liberado (reuso de busca) também conta.
CREATE OR REPLACE FUNCTION search_index_enqueue_result() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  row_data search_results%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM search_access_orders o
     WHERE o.search_query_id = row_data.search_query_id AND o.status IN ('paid', 'free')
  ) THEN
    PERFORM search_index_enqueue_by_establishment_id(row_data.establishment_id, 'result_' || lower(TG_OP));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION search_index_enqueue_deal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM search_index_enqueue_by_establishment_id(OLD.establishment_id, 'deal_' || lower(TG_OP));
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM search_index_enqueue_by_establishment_id(NEW.establishment_id, 'deal_' || lower(TG_OP));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.saved_establishments') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_search_index_saved ON saved_establishments';
    EXECUTE 'CREATE TRIGGER trg_search_index_saved AFTER INSERT OR DELETE ON saved_establishments
             FOR EACH ROW EXECUTE FUNCTION search_index_enqueue_saved()';
  END IF;
  IF to_regclass('public.search_access_orders') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_search_index_orders ON search_access_orders';
    EXECUTE 'CREATE TRIGGER trg_search_index_orders AFTER INSERT OR UPDATE OF status ON search_access_orders
             FOR EACH ROW EXECUTE FUNCTION search_index_enqueue_order()';
  END IF;
  IF to_regclass('public.search_results') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_search_index_results ON search_results';
    EXECUTE 'CREATE TRIGGER trg_search_index_results AFTER INSERT OR DELETE ON search_results
             FOR EACH ROW EXECUTE FUNCTION search_index_enqueue_result()';
  END IF;
  IF to_regclass('public.crm_deals') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_search_index_deals ON crm_deals';
    EXECUTE 'CREATE TRIGGER trg_search_index_deals AFTER INSERT OR DELETE OR UPDATE OF establishment_id ON crm_deals
             FOR EACH ROW EXECUTE FUNCTION search_index_enqueue_deal()';
  END IF;
END;
$$;

-- Carga inicial: não enfileira nada aqui. Depois de aplicar, rode a reindexação completa
-- (POST /api/search/sync?mode=reindex com o segredo), que lê direto de establishments.
