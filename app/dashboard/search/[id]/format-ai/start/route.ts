import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import {
  ensureSearchAccessOrderForSearch,
  getSearchAiFormatOrderBySearchQueryId,
  markSearchAiFormatOrderProcessingStarted,
  readSearchAiFormatProcessingStatus,
  resetSearchAiFormatOrderProcessing,
  syncSearchAccessOrderPaymentStatus,
  syncSearchAiFormatOrderPaymentStatus
} from "@/lib/billing";
import { processSearchAiFormattingOrderStep } from "@/lib/ai-formatting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: Request, { params }: RouteProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    return NextResponse.json({ message: "Faça login para preparar sua lista com IA." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const forceRestart = body?.force === true;

  const { data: search } = await db
    .from("search_queries")
    .select("id, profile_id, provider, total_results")
    .eq("id", id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!search) {
    return NextResponse.json({ message: "Busca não encontrada." }, { status: 404 });
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
    return NextResponse.json({ message: "A compra da lista base ainda não foi confirmada." }, { status: 403 });
  }

  const aiOrder = await getSearchAiFormatOrderBySearchQueryId(id);
  if (!aiOrder) {
    return NextResponse.json({ message: "O upgrade com IA ainda não foi ativado para esta busca." }, { status: 403 });
  }

  const syncedAiOrder = await syncSearchAiFormatOrderPaymentStatus(aiOrder);
  if (syncedAiOrder.status !== "paid") {
    return NextResponse.json({ message: "O pagamento do upgrade com IA ainda não foi confirmado." }, { status: 403 });
  }

  const currentStatus = readSearchAiFormatProcessingStatus(syncedAiOrder);

  if (currentStatus === "ready") {
    return NextResponse.json({ status: "ready", message: "A lista formatada com IA já está pronta para download." });
  }

  if (currentStatus === "processing") {
    return NextResponse.json({ status: "processing", message: "A lista com IA já está em processamento." }, { status: 202 });
  }

  if (currentStatus === "error" && !forceRestart) {
    return NextResponse.json(
      {
        status: "error",
        message: syncedAiOrder.format_error || "A última tentativa falhou. Clique em tentar novamente."
      },
      { status: 409 }
    );
  }

  if (currentStatus === "error" && forceRestart) {
    await resetSearchAiFormatOrderProcessing({ orderId: syncedAiOrder.id, clearPayload: true });
  }

  const claim = await markSearchAiFormatOrderProcessingStarted({ orderId: syncedAiOrder.id });
  const claimedOrder = claim.order;

  if (!claim.started || !claimedOrder) {
    const status = claimedOrder ? readSearchAiFormatProcessingStatus(claimedOrder) : "processing";
    return NextResponse.json({ status, message: "A preparação já foi iniciada por outra execução." }, { status: 202 });
  }

  try {
    await processSearchAiFormattingOrderStep({ order: claimedOrder, maxChunks: 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao iniciar o processamento da lista com IA.";
    return NextResponse.json({ status: "error", message }, { status: 500 });
  }

  return NextResponse.json(
    {
      status: "processing",
      message: "Estamos preparando sua lista com IA. Enquanto esta tela estiver aberta, o processamento continuará avançando."
    },
    { status: 202 }
  );
}
