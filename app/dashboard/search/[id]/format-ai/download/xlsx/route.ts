import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ensureSearchAccessOrderForSearch,
  getSearchAiFormatOrderBySearchQueryId,
  syncSearchAccessOrderPaymentStatus,
  syncSearchAiFormatOrderPaymentStatus
} from "@/lib/billing";
import { ensureSearchAiFormattingPayload, buildAiFormattedWorkbookRows } from "@/lib/ai-formatting";
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
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Faça login para baixar a lista formatada.", { status: 401 });
  }

  const { data: search } = await supabase
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
    return new NextResponse("A formatação por IA ainda não foi contratada para esta lista.", { status: 403 });
  }

  const syncedAiOrder = await syncSearchAiFormatOrderPaymentStatus(aiOrder);
  if (syncedAiOrder.status !== "paid") {
    return new NextResponse("A cobrança da formatação por IA ainda não foi confirmada.", { status: 403 });
  }

  const payload = await ensureSearchAiFormattingPayload(syncedAiOrder);
  const workbookRows = buildAiFormattedWorkbookRows(payload);
  const workbook = createXlsxWorkbook({
    sheets: [
      {
        name: "Resumo IA",
        rows: workbookRows.summaryRows,
        columnWidths: [24, 72],
        wrapColumns: [1]
      },
      {
        name: "Lista formatada IA",
        rows: workbookRows.listRows,
        columnWidths: [10, 30, 24, 22, 16, 14, 30, 34, 26, 16, 20, 16, 18, 34, 18, 30, 26, 18, 14, 34],
        wrapColumns: [1, 2, 6, 7, 8, 10, 13, 15, 16, 17, 19]
      }
    ]
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
