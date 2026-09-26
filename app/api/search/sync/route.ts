import { NextResponse } from "next/server";
import { getSearchEngineConfig, getSearchSyncSecret } from "@/lib/search/config";
import { SEARCH_NO_STORE, isAuthorizedSyncRequest } from "@/lib/search/http";
import { isSearchEngineError } from "@/lib/search/meilisearch";
import { drainSearchOutbox, purgeExpiredDocuments, reindexAllCompanies } from "@/lib/search/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sincronização banco → índice. Protegida por SEARCH_SYNC_SECRET (ou CRON_SECRET).
 *   GET/POST /api/search/sync               → drena a fila (padrão) e expira vencidos
 *   GET/POST /api/search/sync?mode=drain    → só drena a fila
 *   GET/POST /api/search/sync?mode=purge    → só remove documentos vencidos
 *   POST     /api/search/sync?mode=reindex  → reconstrução completa com troca atômica
 */
async function handle(request: Request) {
  if (!isAuthorizedSyncRequest(request, getSearchSyncSecret())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401, headers: SEARCH_NO_STORE });
  }
  const config = getSearchEngineConfig();
  if (!config.url || !config.adminKey || !config.companyIndexEnabled) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: "Índice de empresas desligado (MEILISEARCH_URL, MEILISEARCH_ADMIN_KEY, SEARCH_COMPANY_INDEX_ENABLED)." },
      { headers: SEARCH_NO_STORE }
    );
  }
  const mode = new URL(request.url).searchParams.get("mode") ?? "default";
  try {
    if (mode === "reindex") {
      if (request.method !== "POST") return NextResponse.json({ error: "Use POST para reindexar." }, { status: 405, headers: SEARCH_NO_STORE });
      return NextResponse.json({ ok: true, mode, ...(await reindexAllCompanies()) }, { headers: SEARCH_NO_STORE });
    }
    const result: Record<string, unknown> = { ok: true, mode };
    if (mode === "default" || mode === "drain") result.drain = await drainSearchOutbox();
    if (mode === "default" || mode === "purge") result.purge = await purgeExpiredDocuments();
    return NextResponse.json(result, { headers: SEARCH_NO_STORE });
  } catch (error) {
    const kind = isSearchEngineError(error) ? error.kind : "unknown";
    console.error("[search] sincronização falhou", { kind, mode });
    // A fila é preservada: nada é perdido, a próxima execução retoma.
    return NextResponse.json({ ok: false, mode, error: "Sincronização falhou; a fila foi preservada.", kind }, { status: 503, headers: SEARCH_NO_STORE });
  }
}

export const GET = handle;
export const POST = handle;
