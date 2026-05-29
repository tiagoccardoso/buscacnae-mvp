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
import { buildAiFormattedWorkbookSheets, type SearchAiFormattedPayload } from "@/lib/ai-formatting";
import { createXlsxWorkbook } from "@/lib/export/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }> | { id: string };
};

function sanitizeFilePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    return new NextResponse("Faça login para baixar sua lista pronta para prospecção.", { status: 401 });
  }

  const { data: search } = await db
    .from("search_queries")
    .select("id, profile_id, provider, total_results, cnae_code, city_name, state_code")
    .eq("id", id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!search) {
    return new NextResponse("Busca não encontrada.", { status: 404 });
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
    return new NextResponse("A compra da lista ainda não foi efetivada.", { status: 403 });
  }

  const aiOrder = await getSearchAiFormatOrderBySearchQueryId(id);
  if (!aiOrder) {
    return new NextResponse("O upgrade da lista pronta para prospecção com IA ainda não foi ativado para esta lista.", { status: 403 });
  }

  const syncedAiOrder = await syncSearchAiFormatOrderPaymentStatus(aiOrder);
  if (syncedAiOrder.status !== "paid") {
    return new NextResponse("O pagamento do upgrade com IA ainda não foi confirmado para liberar os downloads.", { status: 403 });
  }

  const processingStatus = readSearchAiFormatProcessingStatus(syncedAiOrder);
  if (processingStatus !== "ready" || !syncedAiOrder.formatted_payload) {
    const message =
      processingStatus === "error"
        ? syncedAiOrder.format_error || "A preparação com IA falhou. Tente novamente."
        : "A formatação com IA ainda está em processamento. Tente novamente em instantes.";
    return NextResponse.json(
      {
        status: processingStatus,
        message
      },
      { status: 409 }
    );
  }

  const { data: rows } = await db
    .from("search_results")
    .select("position, provider_payload, establishments(*)")
    .eq("search_query_id", id)
    .order("position", { ascending: true });

  const workbook = createXlsxWorkbook({
    sheets: buildAiFormattedWorkbookSheets(
      syncedAiOrder.formatted_payload as SearchAiFormattedPayload,
      (rows ?? []) as Array<Record<string, unknown>>
    )
  });

  const fileParts = [
    "buscacnae",
    "ia",
    sanitizeFilePart(search.cnae_code ?? "pesquisa"),
    sanitizeFilePart(search.city_name ?? "lista"),
    sanitizeFilePart(search.state_code ?? "br"),
    syncedAiOrder.id.slice(0, 8)
  ].filter(Boolean);

  const filename = `${fileParts.join("-")}.xlsx`;

  return new NextResponse(workbook, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
