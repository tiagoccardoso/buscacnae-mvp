import { NextResponse } from "next/server";
import { getSearchSyncSecret } from "@/lib/search/config";
import { SEARCH_NO_STORE, isAuthorizedSyncRequest } from "@/lib/search/http";
import { getSearchIndexHealth } from "@/lib/search/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Consistência do índice (atraso da fila, última sincronização, erros). Uso operacional. */
export async function GET(request: Request) {
  if (!isAuthorizedSyncRequest(request, getSearchSyncSecret())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401, headers: SEARCH_NO_STORE });
  }
  return NextResponse.json(await getSearchIndexHealth(), { headers: SEARCH_NO_STORE });
}
