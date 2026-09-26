import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { CompanySearchUnavailableError, searchCompanies } from "@/lib/search/company-search";
import { SEARCH_NO_STORE, parseCompanySearchParams } from "@/lib/search/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search/companies?q=&uf=&cityIbge=&city=&cnae=&status=&size=&hq=&page=&limit=&facets=1
 *
 * Busca textual (com tolerância a erro, facetas e filtros) nas empresas que o usuário
 * JÁ pode ver. Devolve também a interpretação da consulta e, quando há atividade
 * reconhecida, a sugestão de busca de empresas NOVAS na Casa dos Dados.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Faça login para pesquisar." }, { status: 401, headers: SEARCH_NO_STORE });

  // Autocomplete dispara várias consultas por minuto; o limite protege o mecanismo, não o usuário comum.
  const limited = checkRateLimit(`search:${user.id}`, 600);
  if (limited.limited) {
    return NextResponse.json(
      { error: "Muitas pesquisas em sequência. Aguarde alguns instantes." },
      { status: 429, headers: { ...SEARCH_NO_STORE, "Retry-After": String(limited.retryAfter) } }
    );
  }

  const parsed = parseCompanySearchParams(request.nextUrl.searchParams);
  try {
    const result = await searchCompanies({ profileId: user.id, ...parsed, signal: request.signal });
    return NextResponse.json(result, { headers: SEARCH_NO_STORE });
  } catch (error) {
    if (error instanceof CompanySearchUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503, headers: SEARCH_NO_STORE });
    }
    console.error("[search] falha na busca", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Não foi possível pesquisar agora." }, { status: 500, headers: SEARCH_NO_STORE });
  }
}
