import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ensureSearchAccessOrderForSearch,
  getSearchAiFormatOrderBySearchQueryId,
  readSearchAiFormatProcessingStatus,
  syncSearchAccessOrderPaymentStatus,
  syncSearchAiFormatOrderPaymentStatus
} from "@/lib/billing";
import { processSearchAiFormattingOrderStep } from "@/lib/ai-formatting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ message: "Faça login para preparar sua lista com IA." }, { status: 401 });
  }

  const { data: search } = await supabase
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

  const processingStatus = readSearchAiFormatProcessingStatus(syncedAiOrder);
  if (processingStatus === "ready") {
    return NextResponse.json({ status: "ready", message: "A lista formatada com IA já está pronta para download." });
  }

  if (processingStatus !== "processing") {
    return NextResponse.json(
      { status: processingStatus, message: syncedAiOrder.format_error || "A preparação ainda não foi iniciada." },
      { status: 409 }
    );
  }

  try {
    const result = await processSearchAiFormattingOrderStep({ order: syncedAiOrder, maxChunks: 1 });

    if (result.status === "ready") {
      return NextResponse.json({ status: "ready", message: "A lista formatada com IA está pronta para download." });
    }

    return NextResponse.json(
      {
        status: "processing",
        message: "Estamos preparando sua lista com IA. Enquanto esta tela estiver aberta, o processamento continuará avançando."
      },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha durante o processamento da lista com IA.";
    return NextResponse.json({ status: "error", message }, { status: 500 });
  }
}
