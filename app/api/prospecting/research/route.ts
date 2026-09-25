import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { buildDisplayEstablishment } from "@/lib/establishment-presenter";
import { buildResearchBrief } from "@/lib/prospecting/research";
import { extractSingleObject } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_PATTERN = /^[0-9a-zA-Z-]{1,64}$/;

/**
 * Pesquisa assistida com fatos do próprio estabelecimento salvo.
 * A resposta não consulta contatos pessoais nem permite que o modelo invente
 * afirmações externas: cada claim retorna sua origem e data de coleta.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Faça login para pesquisar empresas." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const establishmentId = body && typeof body === "object" ? String((body as { establishmentId?: unknown }).establishmentId ?? "") : "";
  if (!ID_PATTERN.test(establishmentId)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  const db = createDbClient();
  const { data: row } = await db.from("saved_establishments").select("establishment_id, establishments(*)").eq("profile_id", user.id).eq("establishment_id", establishmentId).maybeSingle();
  const establishment = extractSingleObject(row?.establishments);
  if (!establishment) return NextResponse.json({ error: "Empresa não está na sua carteira." }, { status: 404 });

  const display = buildDisplayEstablishment(establishment);
  const brief = buildResearchBrief({
    companyName: String(display.company_name ?? ""),
    cityName: String(display.city_name ?? ""),
    stateCode: String(display.state_code ?? ""),
    primaryCnaeCode: String(display.primary_cnae_code ?? ""),
    primaryCnaeDescription: String(display.primary_cnae_description ?? ""),
    companySize: String(display.company_size ?? ""),
    registrationStatus: String(display.registration_status ?? ""),
    openedAt: String(display.opened_at ?? ""),
    website: String(display.website ?? ""),
    email: "",
    phone: ""
  });

  return NextResponse.json({ brief }, { headers: { "Cache-Control": "no-store" } });
}
