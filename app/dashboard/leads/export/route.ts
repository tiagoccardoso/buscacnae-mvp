import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { buildDisplayEstablishment } from "@/lib/establishment-presenter";
import { extractSingleObject } from "@/lib/utils";
import { calculateLeadScore, normalizeScoreCriteria, scoreExplanation } from "@/lib/prospecting/score";

function csv(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Faça login para exportar." }, { status: 401 });

  const listId = new URL(request.url).searchParams.get("list")?.trim() ?? "";
  const db = createDbClient();
  // Keep the export readable while the additive Fase 5 migration is pending.
  let query = db.from("saved_establishments").select("created_at, notes, list_id, saved_lead_lists(id,name), establishments(*)").eq("profile_id", user.id).order("created_at", { ascending: false });
  if (listId) query = query.eq("list_id", listId);
  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: "Não foi possível exportar a lista." }, { status: 500 });
  const [{ data: listCriteriaRows }, { data: metaRows }] = await Promise.all([
    db.from("saved_lead_lists").select("id,score_criteria").eq("profile_id", user.id),
    db.from("saved_establishments").select("establishment_id,tags,stage").eq("profile_id", user.id)
  ]);
  const criteriaByListId = new Map((listCriteriaRows ?? []).map((item) => [String(item.id), item.score_criteria]));
  const metaByEstablishmentId = new Map((metaRows ?? []).map((item) => [String(item.establishment_id), item]));

  const header = ["empresa", "nome_fantasia", "cnpj", "cidade", "uf", "cnae_principal", "porte", "situacao_oficial", "abertura", "capital_social", "email_oficial", "telefone_oficial", "site_oficial", "lista", "tags_operacionais", "notas_operacionais", "etapa", "score_deterministico", "explicacao_score", "origem_cadastro"];
  const lines = [header.map(csv).join(",")];
  for (const row of rows ?? []) {
    const establishment = extractSingleObject(row.establishments);
    if (!establishment) continue;
    const display = buildDisplayEstablishment(establishment);
    const list = extractSingleObject(row.saved_lead_lists);
    const meta = metaByEstablishmentId.get(String(establishment.id));
    const score = calculateLeadScore({
      registrationStatus: String(display.registration_status ?? ""),
      companySize: String(display.company_size ?? ""),
      stateCode: String(display.state_code ?? ""),
      primaryCnaeCode: String(display.primary_cnae_code ?? ""),
      openedAt: String(display.opened_at ?? ""),
      website: String(display.website ?? ""),
      email: String(display.email ?? ""),
      phone: String(display.phone ?? "")
    }, normalizeScoreCriteria(criteriaByListId.get(String(list?.id ?? row.list_id ?? ""))));
    const values = [
      display.company_name,
      display.trade_name,
      display.cnpj,
      display.city_name,
      display.state_code,
      display.primary_cnae_code,
      display.company_size,
      display.registration_status,
      display.opened_at,
      display.capital_social,
      display.email,
      display.phone,
      display.website,
      list?.name,
      Array.isArray(meta?.tags) ? meta.tags.join(" | ") : "",
      row.notes,
      meta?.stage ?? "new",
      score.score,
      scoreExplanation(score),
      "official:Casa dos Dados"
    ];
    lines.push(values.map(csv).join(","));
  }

  const body = `\uFEFF${lines.join("\n")}\n`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="buscacnae-prospeccao${listId ? "-lista" : ""}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
