import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ensureSearchAccessOrderForSearch,
  getSearchAiFormatOrderBySearchQueryId,
  syncSearchAccessOrderPaymentStatus,
  syncSearchAiFormatOrderPaymentStatus
} from "@/lib/billing";
import { ensureSearchAiFormattingPayload } from "@/lib/ai-formatting";
import { createFormattedListPdf } from "@/lib/export/pdf";
import { formatDateTime } from "@/lib/format";

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
  const pdf = createFormattedListPdf({
    title: `${payload.headline} · Lista formatada por IA`,
    subtitle: payload.subtitle,
    generatedAt: formatDateTime(payload.generatedAt),
    summary: payload.summary,
    records: payload.records
  });

  const fileParts = [
    "buscacnae",
    "ia",
    sanitizeFilePart(search.cnae_code ?? "pesquisa"),
    sanitizeFilePart(search.city_name ?? "lista"),
    sanitizeFilePart(search.state_code ?? "br"),
    syncedAiOrder.id.slice(0, 8)
  ].filter(Boolean);

  const filename = `${fileParts.join("-")}.pdf`;

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
