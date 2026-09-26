import { sql } from "@/lib/db";

/**
 * Quem pode ver uma empresa na busca da própria base (Fase 7).
 *
 * Uma empresa só entra no índice para um usuário se ele JÁ tem acesso a ela no produto:
 *   - resultado de uma busca cujo pedido foi liberado (status paid/free);
 *   - empresa salva por ele (carteira/listas);
 *   - negócio no CRM de um workspace do qual participa (filtrado por workspace na consulta).
 * Prévias não pagas NÃO entram: o índice não pode vazar o que está bloqueado na tela.
 */

type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const defaultQuery: Query = (text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>;

let crmAvailable: boolean | null = null;

/** Somente para testes. */
export function resetVisibilityCache() {
  crmAvailable = null;
}

async function hasCrmTables(query: Query) {
  if (crmAvailable !== null) return crmAvailable;
  const rows = await query(`SELECT to_regclass('public.crm_deals') IS NOT NULL AS ok`);
  crmAvailable = rows[0]?.ok === true;
  return crmAvailable;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.startsWith("{")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

export type VisibilityByEstablishment = Map<string, { profileIds: string[]; workspaceIds: string[] }>;

export async function loadVisibility(establishmentIds: string[], query: Query = defaultQuery): Promise<VisibilityByEstablishment> {
  const result: VisibilityByEstablishment = new Map();
  const ids = Array.from(new Set(establishmentIds.filter(Boolean)));
  if (ids.length === 0) return result;
  const withCrm = await hasCrmTables(query);
  const rows = await query(
    `SELECT e.id::text AS establishment_id,
            COALESCE((
              SELECT array_agg(DISTINCT v.profile_id) FROM (
                SELECT COALESCE(o.profile_id, sr.profile_id)::text AS profile_id
                  FROM search_results sr
                  JOIN search_access_orders o ON o.search_query_id = sr.search_query_id AND o.status IN ('paid', 'free')
                 WHERE sr.establishment_id = e.id
                UNION
                SELECT se.profile_id::text FROM saved_establishments se WHERE se.establishment_id = e.id
              ) v WHERE v.profile_id IS NOT NULL
            ), ARRAY[]::text[]) AS profile_ids,
            ${
              withCrm
                ? `COALESCE((SELECT array_agg(DISTINCT d.workspace_id::text) FROM crm_deals d WHERE d.establishment_id = e.id), ARRAY[]::text[])`
                : `ARRAY[]::text[]`
            } AS workspace_ids
       FROM establishments e
      WHERE e.id::text = ANY($1)`,
    [ids]
  );
  for (const row of rows) {
    result.set(String(row.establishment_id), {
      profileIds: toStringArray(row.profile_ids),
      workspaceIds: toStringArray(row.workspace_ids)
    });
  }
  return result;
}

/** Workspaces do CRM do usuário (consultado a cada busca: mudança de membros vale na hora). */
export async function loadWorkspaceIds(profileId: string, query: Query = defaultQuery): Promise<string[]> {
  if (!profileId) return [];
  try {
    if (!(await hasCrmTables(query))) return [];
    const rows = await query(`SELECT workspace_id::text AS id FROM crm_workspace_members WHERE profile_id::text = $1`, [profileId]);
    return rows.map((row) => String(row.id)).filter(Boolean);
  } catch {
    return [];
  }
}

/** Condição SQL (para o fallback no banco) com as mesmas regras de visibilidade. */
export async function visibleEstablishmentsSql(profileParam: string, workspacesParam: string, query: Query = defaultQuery) {
  const withCrm = await hasCrmTables(query).catch(() => false);
  return `(
    SELECT sr.establishment_id FROM search_results sr
      JOIN search_access_orders o ON o.search_query_id = sr.search_query_id AND o.status IN ('paid', 'free')
     WHERE COALESCE(o.profile_id, sr.profile_id)::text = ${profileParam}
    UNION
    SELECT se.establishment_id FROM saved_establishments se WHERE se.profile_id::text = ${profileParam}
    ${withCrm ? `UNION SELECT d.establishment_id FROM crm_deals d WHERE d.workspace_id::text = ANY(${workspacesParam})` : ""}
  )`;
}
