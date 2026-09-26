import { sql } from "@/lib/db";
import { toCompanySearchDocument, type CompanySearchDocument } from "@/lib/search/company-documents";
import {
  deleteCompanyDocuments,
  deleteExpiredCompanyDocuments,
  deleteIndex,
  ensureCompanyIndex,
  getCompanyIndexStats,
  replaceCompanyDocuments,
  swapIndexes
} from "@/lib/search/company-index";
import { companyIndexUid, getSearchEngineConfig } from "@/lib/search/config";
import { createMeiliClient, isSearchEngineError, type MeiliClient } from "@/lib/search/meilisearch";
import { loadVisibility } from "@/lib/search/visibility";

/**
 * Sincronização banco → índice (Fase 7).
 *
 * Modelo: outbox transacional + leitura do ESTADO ATUAL.
 *  - Os gatilhos (sql/neon_search_index.sql) enfileiram o CNPJ na mesma transação da escrita.
 *  - O worker lê um lote da fila, relê as linhas atuais de `establishments` e da
 *    visibilidade, e grava no índice (substitui documento inteiro ou exclui).
 *  - Só depois de o Meilisearch confirmar a tarefa, os itens lidos saem da fila.
 * Consequências: entrega "pelo menos uma vez", idempotente e sem ordem a respeitar
 * (o documento sempre reflete o banco no momento do processamento). Se o índice cair,
 * a fila cresce e é drenada quando ele voltar — nada se perde.
 */

type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
const defaultQuery: Query = (text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>;

export type SyncDependencies = {
  client?: MeiliClient;
  indexUid?: string;
  query?: Query;
  nowEpoch?: number;
  ttlDays?: number;
  batchSize?: number;
};

function resolveDependencies(dependencies: SyncDependencies) {
  const config = getSearchEngineConfig();
  const client =
    dependencies.client ?? createMeiliClient({ url: config.url, apiKey: config.adminKey, timeoutMs: Math.max(config.timeoutMs, 10_000) });
  return {
    client,
    indexUid: dependencies.indexUid ?? companyIndexUid(config),
    query: dependencies.query ?? defaultQuery,
    nowEpoch: dependencies.nowEpoch ?? Math.floor(Date.now() / 1000),
    ttlDays: dependencies.ttlDays ?? config.ttlDays,
    batchSize: Math.max(1, dependencies.batchSize ?? config.syncBatchSize)
  };
}

function epochOf(value: unknown) {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function parseRow(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** Monta documentos (ou exclusões) para um conjunto de CNPJs a partir do estado atual do banco. */
export async function buildDocumentsForCnpjs(
  cnpjs: string[],
  deps: { query: Query; nowEpoch: number; ttlDays: number; enqueuedAtByCnpj?: Map<string, number> }
) {
  const unique = Array.from(new Set(cnpjs.filter(Boolean)));
  const upserts: CompanySearchDocument[] = [];
  const deletes: string[] = [];
  if (unique.length === 0) return { upserts, deletes };

  const rows = await deps.query(`SELECT e.id::text AS id, to_jsonb(e.*) AS row FROM establishments e WHERE e.cnpj = ANY($1)`, [unique]);
  const byCnpj = new Map<string, { id: string; row: Record<string, unknown> }>();
  for (const item of rows) {
    const row = parseRow(item.row);
    if (row && typeof row.cnpj === "string") byCnpj.set(row.cnpj, { id: String(item.id), row });
  }
  const visibility = await loadVisibility(
    Array.from(byCnpj.values()).map((item) => item.id),
    deps.query
  );

  for (const cnpj of unique) {
    const found = byCnpj.get(cnpj);
    if (!found) {
      deletes.push(cnpj);
      continue;
    }
    const document = toCompanySearchDocument(found.row, visibility.get(found.id) ?? { profileIds: [], workspaceIds: [] }, {
      nowEpoch: deps.nowEpoch,
      ttlDays: deps.ttlDays
    });
    // Sem dono visível, ou já vencido: sai do índice (não é servido nem ocupa espaço).
    if (!document || document.expiresAt <= deps.nowEpoch) deletes.push(cnpj);
    else upserts.push(document);
  }
  return { upserts, deletes };
}

async function recordState(query: Query, indexUid: string, patch: { sync?: boolean; purge?: boolean; reindex?: boolean; upserted?: number; deleted?: number; error?: string | null }) {
  await query(
    `INSERT INTO search_index_state (index_uid, last_sync_at, last_purge_at, last_full_reindex_at, last_error, last_error_at, documents_upserted, documents_deleted, updated_at)
     VALUES ($1, CASE WHEN $2 THEN NOW() END, CASE WHEN $3 THEN NOW() END, CASE WHEN $4 THEN NOW() END, $5, CASE WHEN $5::text IS NOT NULL THEN NOW() END, $6, $7, NOW())
     ON CONFLICT (index_uid) DO UPDATE SET
       last_sync_at = COALESCE(CASE WHEN $2 THEN NOW() END, search_index_state.last_sync_at),
       last_purge_at = COALESCE(CASE WHEN $3 THEN NOW() END, search_index_state.last_purge_at),
       last_full_reindex_at = COALESCE(CASE WHEN $4 THEN NOW() END, search_index_state.last_full_reindex_at),
       last_error = CASE WHEN $5::text IS NOT NULL THEN $5 WHEN $2 OR $4 THEN NULL ELSE search_index_state.last_error END,
       last_error_at = CASE WHEN $5::text IS NOT NULL THEN NOW() ELSE search_index_state.last_error_at END,
       documents_upserted = search_index_state.documents_upserted + $6,
       documents_deleted = search_index_state.documents_deleted + $7,
       updated_at = NOW()`,
    [indexUid, Boolean(patch.sync), Boolean(patch.purge), Boolean(patch.reindex), patch.error ?? null, patch.upserted ?? 0, patch.deleted ?? 0]
  ).catch((error: unknown) => {
    console.warn("[search] não foi possível registrar o estado da sincronização", { name: error instanceof Error ? error.name : "unknown" });
  });
}

export type DrainResult = { processedEvents: number; upserted: number; deleted: number; remaining: number | null };

/** Processa até `maxBatches` lotes da fila. Seguro para rodar em paralelo? Não: use um único agendador. */
export async function drainSearchOutbox(dependencies: SyncDependencies & { maxBatches?: number } = {}): Promise<DrainResult> {
  const deps = resolveDependencies(dependencies);
  const totals = { processedEvents: 0, upserted: 0, deleted: 0 };
  try {
    await ensureCompanyIndex(deps.client, deps.indexUid);
    for (let batch = 0; batch < (dependencies.maxBatches ?? 10); batch += 1) {
      const events = await deps.query(`SELECT id, cnpj FROM search_index_outbox ORDER BY id LIMIT $1`, [deps.batchSize]);
      if (events.length === 0) break;
      const eventIds = events.map((event) => Number(event.id));
      const { upserts, deletes } = await buildDocumentsForCnpjs(
        events.map((event) => String(event.cnpj)),
        deps
      );
      const tasks = [
        await replaceCompanyDocuments(deps.client, deps.indexUid, upserts),
        await deleteCompanyDocuments(deps.client, deps.indexUid, deletes)
      ].filter((task): task is number => task !== null);
      for (const task of tasks) await deps.client.waitForTask(task, { timeoutMs: 120_000 });
      // Confirmação: só remove da fila o que foi efetivamente aplicado no índice.
      await deps.query(`DELETE FROM search_index_outbox WHERE id = ANY($1::bigint[])`, [eventIds]);
      totals.processedEvents += events.length;
      totals.upserted += upserts.length;
      totals.deleted += deletes.length;
      if (events.length < deps.batchSize) break;
    }
    await recordState(deps.query, deps.indexUid, { sync: true, upserted: totals.upserted, deleted: totals.deleted });
  } catch (error) {
    await recordState(deps.query, deps.indexUid, { error: describeError(error) });
    throw error;
  }
  const remainingRows = await deps.query(`SELECT COUNT(*)::int AS n FROM search_index_outbox`).catch(() => []);
  return { ...totals, remaining: remainingRows[0] ? Number(remainingRows[0].n) : null };
}

/** Remove do índice documentos cujo dado de origem passou da validade (SEARCH_INDEX_TTL_DAYS). */
export async function purgeExpiredDocuments(dependencies: SyncDependencies = {}) {
  const deps = resolveDependencies(dependencies);
  const task = await deleteExpiredCompanyDocuments(deps.client, deps.indexUid, deps.nowEpoch);
  const result = await deps.client.waitForTask(task, { timeoutMs: 120_000 });
  const deleted = Number((result.details as { deletedDocuments?: number } | null)?.deletedDocuments ?? 0);
  await recordState(deps.query, deps.indexUid, { purge: true, deleted });
  return { deleted };
}

/**
 * Reindexação completa sem indisponibilidade: constrói `<uid>_rebuild`, troca de lugar
 * com o índice ativo (swap atômico) e apaga o antigo. Eventos da fila anteriores ao
 * início ficam cobertos pela releitura e são descartados; os posteriores permanecem.
 */
export async function reindexAllCompanies(dependencies: SyncDependencies = {}) {
  const deps = resolveDependencies(dependencies);
  const rebuildUid = `${deps.indexUid}_rebuild`;
  const startedAt = performance.now();
  const watermarkRows = await deps.query(`SELECT COALESCE(MAX(id), 0)::bigint AS max_id FROM search_index_outbox`);
  const watermark = Number(watermarkRows[0]?.max_id ?? 0);

  await deleteIndex(deps.client, rebuildUid)
    .then((task) => deps.client.waitForTask(task))
    .catch(() => null);
  await ensureCompanyIndex(deps.client, rebuildUid);
  await ensureCompanyIndex(deps.client, deps.indexUid);

  let cursor = "";
  let indexed = 0;
  let skipped = 0;
  for (;;) {
    const rows = await deps.query(
      `SELECT e.cnpj FROM establishments e WHERE e.cnpj IS NOT NULL AND e.cnpj > $1 ORDER BY e.cnpj LIMIT $2`,
      [cursor, deps.batchSize]
    );
    if (rows.length === 0) break;
    const cnpjs = rows.map((row) => String(row.cnpj));
    cursor = cnpjs[cnpjs.length - 1];
    const { upserts, deletes } = await buildDocumentsForCnpjs(cnpjs, deps);
    const task = await replaceCompanyDocuments(deps.client, rebuildUid, upserts);
    if (task !== null) await deps.client.waitForTask(task, { timeoutMs: 600_000 });
    indexed += upserts.length;
    skipped += deletes.length;
    if (rows.length < deps.batchSize) break;
  }

  await deps.client.waitForTask(await swapIndexes(deps.client, deps.indexUid, rebuildUid), { timeoutMs: 120_000 });
  await deleteIndex(deps.client, rebuildUid)
    .then((task) => deps.client.waitForTask(task))
    .catch(() => null);
  await deps.query(`DELETE FROM search_index_outbox WHERE id <= $1`, [watermark]);
  await recordState(deps.query, deps.indexUid, { reindex: true, sync: true, upserted: indexed });
  return { indexed, skipped, durationMs: Math.round(performance.now() - startedAt) };
}

export type SearchIndexHealth = {
  configured: boolean;
  companyIndexEnabled: boolean;
  engine: "available" | "unavailable" | "not_configured";
  documents: number | null;
  isIndexing: boolean | null;
  outboxBacklog: number | null;
  oldestPendingSeconds: number | null;
  lastSyncAt: string | null;
  lastFullReindexAt: string | null;
  lastPurgeAt: string | null;
  lastError: string | null;
  ttlDays: number;
};

/** Visão de consistência: quanto o índice está atrás do banco. Não expõe chaves nem URL. */
export async function getSearchIndexHealth(dependencies: SyncDependencies = {}): Promise<SearchIndexHealth> {
  const config = getSearchEngineConfig();
  const query = dependencies.query ?? defaultQuery;
  const indexUid = dependencies.indexUid ?? companyIndexUid(config);
  const health: SearchIndexHealth = {
    configured: Boolean(config.url),
    companyIndexEnabled: config.companyIndexEnabled,
    engine: config.url ? "unavailable" : "not_configured",
    documents: null,
    isIndexing: null,
    outboxBacklog: null,
    oldestPendingSeconds: null,
    lastSyncAt: null,
    lastFullReindexAt: null,
    lastPurgeAt: null,
    lastError: null,
    ttlDays: config.ttlDays
  };
  if (config.url) {
    try {
      const client = dependencies.client ?? createMeiliClient({ url: config.url, apiKey: config.adminKey || config.searchKey, timeoutMs: 2_000 });
      await client.health();
      health.engine = "available";
      const stats = await getCompanyIndexStats(client, indexUid).catch(() => null);
      if (stats) {
        health.documents = stats.numberOfDocuments;
        health.isIndexing = stats.isIndexing;
      }
    } catch {
      health.engine = "unavailable";
    }
  }
  try {
    const [backlog] = await query(
      `SELECT COUNT(*)::int AS n, EXTRACT(EPOCH FROM (NOW() - MIN(enqueued_at)))::int AS oldest FROM search_index_outbox`
    );
    health.outboxBacklog = backlog ? Number(backlog.n) : 0;
    health.oldestPendingSeconds = backlog?.oldest === null || backlog?.oldest === undefined ? null : Number(backlog.oldest);
    const [state] = await query(`SELECT * FROM search_index_state WHERE index_uid = $1`, [indexUid]);
    if (state) {
      const iso = (value: unknown) => {
        const epoch = epochOf(value);
        return epoch === null ? null : new Date(epoch * 1000).toISOString();
      };
      health.lastSyncAt = iso(state.last_sync_at);
      health.lastFullReindexAt = iso(state.last_full_reindex_at);
      health.lastPurgeAt = iso(state.last_purge_at);
      health.lastError = typeof state.last_error === "string" ? state.last_error : null;
    }
  } catch {
    // Migração ainda não aplicada: saúde parcial.
  }
  return health;
}

function describeError(error: unknown) {
  if (isSearchEngineError(error)) return `${error.kind}: ${error.message}`.slice(0, 500);
  return (error instanceof Error ? error.message : "erro desconhecido").slice(0, 500);
}
