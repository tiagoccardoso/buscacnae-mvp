import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import {
  ensureSearchAccessOrderForSearch,
  getSearchAiFormatOrderBySearchQueryId,
  readSearchAiFormatProcessingStatus,
  syncSearchAccessOrderPaymentStatus,
  syncSearchAiFormatOrderPaymentStatus
} from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }> | { id: string };
};

type AiFormatJobPayloadSummary = {
  totalChunks: number;
  totalRecords: number;
};

function summarizeJobPayload(payload: unknown): AiFormatJobPayloadSummary {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { totalChunks: 0, totalRecords: 0 };
  }

  const record = payload as Record<string, unknown>;
  const aiInputRecords = Array.isArray(record.aiInputRecords) ? record.aiInputRecords.length : 0;
  const sourceRecords = Array.isArray(record.sourceRecords) ? record.sourceRecords.length : 0;
  const chunkSize = Math.max(1, Number(record.chunkSize ?? 8));

  const totalRecords = Math.max(aiInputRecords, sourceRecords, 0);
  const totalChunksFromPayload = Math.max(0, Math.trunc(Number(record.totalChunks ?? 0)));
  const inferredChunks = totalRecords > 0 ? Math.ceil(totalRecords / chunkSize) : 0;

  return {
    totalChunks: Math.max(totalChunksFromPayload, inferredChunks),
    totalRecords
  };
}

function toIsoString(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    return NextResponse.json({ error: "Faça login para consultar o status da preparação com IA." }, { status: 401 });
  }

  const { data: search } = await db
    .from("search_queries")
    .select("id, profile_id, provider, total_results")
    .eq("id", id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!search) {
    return NextResponse.json({ error: "Busca não encontrada." }, { status: 404 });
  }

  const accessOrder = await ensureSearchAccessOrderForSearch({
    searchQueryId: id,
    profileId: user.id,
    email: user.email ?? undefined,
    provider: typeof search.provider === "string" ? search.provider : undefined,
    totalResults: typeof search.total_results === "number" ? search.total_results : undefined
  });

  const syncedAccessOrder = await syncSearchAccessOrderPaymentStatus(accessOrder);
  if (!["paid", "free"].includes(syncedAccessOrder.status)) {
    return NextResponse.json({ error: "A compra da lista base ainda não foi confirmada." }, { status: 403 });
  }

  const aiOrder = await getSearchAiFormatOrderBySearchQueryId(id);
  if (!aiOrder) {
    return NextResponse.json({ error: "O upgrade com IA ainda não foi ativado para esta busca." }, { status: 403 });
  }

  const syncedAiOrder = await syncSearchAiFormatOrderPaymentStatus(aiOrder);
  if (syncedAiOrder.status !== "paid") {
    return NextResponse.json({ error: "O pagamento do upgrade com IA ainda não foi confirmado." }, { status: 403 });
  }

  const status = readSearchAiFormatProcessingStatus(syncedAiOrder);
  const progress = Math.max(0, Math.min(100, Math.trunc(Number(syncedAiOrder.format_progress ?? (status === "ready" ? 100 : 0)))));
  const cursor = Math.max(0, Math.trunc(Number(syncedAiOrder.format_cursor ?? 0)));
  const { totalChunks, totalRecords } = summarizeJobPayload(syncedAiOrder.format_job_payload);

  const startedAt = toIsoString(syncedAiOrder.format_started_at);
  const lastHeartbeatAt = toIsoString(syncedAiOrder.format_last_heartbeat_at);

  const nowMs = Date.now();
  const lastHeartbeatMs = lastHeartbeatAt ? new Date(lastHeartbeatAt).getTime() : NaN;
  const stale = status === "processing" && Number.isFinite(lastHeartbeatMs) ? nowMs - lastHeartbeatMs > 90_000 : false;

  let etaSeconds: number | null = null;
  if (status === "processing" && progress > 0 && progress < 100 && startedAt) {
    const startedMs = new Date(startedAt).getTime();
    if (Number.isFinite(startedMs) && nowMs > startedMs) {
      const elapsedSeconds = (nowMs - startedMs) / 1000;
      const estimatedTotal = elapsedSeconds / (progress / 100);
      const remaining = Math.ceil(estimatedTotal - elapsedSeconds);
      etaSeconds = Number.isFinite(remaining) && remaining > 0 ? remaining : null;
    }
  }

  return NextResponse.json({
    status,
    progress,
    cursor,
    totalChunks,
    totalRecords,
    startedAt,
    lastHeartbeatAt,
    stale,
    etaSeconds,
    error: status === "error" ? syncedAiOrder.format_error || "Não foi possível concluir a preparação com IA." : null
  });
}
