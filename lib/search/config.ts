/**
 * Configuração da Busca Avançada (Fase 7). Tudo opcional: sem MEILISEARCH_URL a
 * aplicação funciona exatamente como antes (Casa dos Dados + banco), e a busca
 * textual usa o fallback no PostgreSQL.
 */

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function readPositiveInt(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(readEnv(name));
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.trunc(value), max);
}

export type SearchEngineConfig = {
  /** URL do Meilisearch (ex.: http://localhost:7700). Vazio = mecanismo desligado. */
  url: string;
  /** Chave de BUSCA (somente leitura) usada pelas rotas de consulta. */
  searchKey: string;
  /** Chave administrativa usada pela sincronização (nunca exposta ao navegador). */
  adminKey: string;
  indexPrefix: string;
  /** Índice de empresas ligado explicitamente (depende de autorização contratual; ver docs/BUSCA_AVANCADA.md). */
  companyIndexEnabled: boolean;
  /** Tempo máximo de uma consulta antes do fallback. */
  timeoutMs: number;
  /** Validade de um documento a partir da data em que o dado foi obtido na fonte. */
  ttlDays: number;
  syncBatchSize: number;
};

export function getSearchEngineConfig(): SearchEngineConfig {
  const url = readEnv("MEILISEARCH_URL").replace(/\/+$/, "");
  const adminKey = readEnv("MEILISEARCH_ADMIN_KEY");
  return {
    url,
    searchKey: readEnv("MEILISEARCH_SEARCH_KEY") || adminKey,
    adminKey,
    indexPrefix: (readEnv("SEARCH_INDEX_PREFIX") || "buscacnae").replace(/[^a-zA-Z0-9_-]/g, "_"),
    companyIndexEnabled: readEnv("SEARCH_COMPANY_INDEX_ENABLED").toLowerCase() === "true",
    timeoutMs: readPositiveInt("SEARCH_TIMEOUT_MS", 800, 10_000),
    ttlDays: readPositiveInt("SEARCH_INDEX_TTL_DAYS", 90, 3650),
    syncBatchSize: readPositiveInt("SEARCH_SYNC_BATCH_SIZE", 1000, 10_000)
  };
}

export function isCompanySearchEngineEnabled(config = getSearchEngineConfig()) {
  return Boolean(config.url && config.searchKey && config.companyIndexEnabled);
}

export function companyIndexUid(config = getSearchEngineConfig()) {
  return `${config.indexPrefix}_companies`;
}

/** Segredo exigido pela rota de sincronização (Vercel Cron envia "Authorization: Bearer <CRON_SECRET>"). */
export function getSearchSyncSecret() {
  return readEnv("SEARCH_SYNC_SECRET") || readEnv("CRON_SECRET");
}
