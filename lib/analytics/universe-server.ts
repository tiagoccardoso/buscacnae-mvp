import { createDbClient } from "@/lib/db-client";
import { getAnalysisMaxCompanies } from "@/lib/env";
import { buildAnalysisUniverse, universeRowLimit, type AnalysisUniverse } from "@/lib/analytics/universe";

type DbClient = ReturnType<typeof createDbClient>;

/**
 * Carrega o universo analisado de uma busca salva (servidor). Usado pela página de
 * resultado (Lista) e por GET /api/map/searches/[id] (Mapa e Inteligência), então as
 * três visões partem das MESMAS linhas, na MESMA ordem, com o MESMO teto.
 *
 * Duas consultas: count(*) das linhas gravadas (reconciliação) e as primeiras N linhas
 * liberadas pela posição. Nunca carrega linhas bloqueadas (antes da compra só 1).
 */
export async function loadSearchUniverse(
  input: { searchId: string; unlocked: boolean; reported: number },
  db: DbClient = createDbClient()
): Promise<AnalysisUniverse> {
  const maxCompanies = getAnalysisMaxCompanies();
  const [countResult, rowsResult] = await Promise.all([
    db.from("search_results").select("establishment_id", { count: "exact", head: true }).eq("search_query_id", input.searchId),
    db
      .from("search_results")
      .select("position, establishment_id, provider_payload, establishments(*)")
      .eq("search_query_id", input.searchId)
      .order("position", { ascending: true })
      .limit(universeRowLimit(input.unlocked, maxCompanies))
  ]);

  const rows = (rowsResult.data ?? []) as Array<Record<string, unknown>>;
  const stored = typeof countResult.count === "number" ? countResult.count : rows.length;

  return buildAnalysisUniverse(rows, {
    unlocked: input.unlocked,
    maxCompanies,
    reported: input.reported,
    stored
  });
}
