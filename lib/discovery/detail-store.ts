import { sql } from "@/lib/db";
import { getDiscoveryDetailReuseHours } from "@/lib/env";
import { normalizeCnpj } from "@/lib/utils";
import {
  CASA_DOS_DADOS_DETAIL_FETCHED_AT_KEY,
  type StoredCasaDosDadosDetail,
  type StoredDetailLookup
} from "@/lib/discovery/providers/casadosdados";

/**
 * Reuso persistente da consulta detalhada da Casa dos Dados (GET /v4/cnpj).
 *
 * A pesquisa avançada (POST /v5/cnpj/pesquisa) não devolve contatos, CNAEs nem
 * Simples/MEI, então cada linha precisa de uma consulta detalhada. Sem reuso, repetir
 * a mesma busca com outro filtro disparava novamente centenas de chamadas pagas.
 *
 * Aqui buscamos, em UMA query, os detalhes já gravados em establishments.provider_payload
 * que ainda estão dentro da janela DISCOVERY_DETAIL_REUSE_HOURS. Somente a própria
 * Casa dos Dados é fonte desses dados; nada é inventado ou complementado.
 */
const MAX_CNPJS_PER_QUERY = 1000;

type Row = { cnpj: unknown; detail: unknown; fetched_at: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseStoredDetailRows(rows: Row[], minFetchedAtIso: string) {
  const result = new Map<string, StoredCasaDosDadosDetail>();
  for (const row of rows) {
    const cnpj = normalizeCnpj(String(row.cnpj ?? ""));
    const fetchedAt = typeof row.fetched_at === "string" ? row.fetched_at : "";
    let detail = row.detail;
    if (typeof detail === "string") {
      try {
        detail = JSON.parse(detail);
      } catch {
        detail = null;
      }
    }
    if (!cnpj || !isRecord(detail) || Object.keys(detail).length === 0) continue;
    const fetchedAtMs = Date.parse(fetchedAt);
    if (!Number.isFinite(fetchedAtMs) || fetchedAtMs < Date.parse(minFetchedAtIso)) continue;
    result.set(cnpj, { raw: detail, fetchedAt: new Date(fetchedAtMs).toISOString() });
  }
  return result;
}

export function createStoredDetailLookup(
  options: { reuseHours?: number; query?: (text: string, params: unknown[]) => Promise<unknown[]> } = {}
): StoredDetailLookup | undefined {
  const reuseHours = options.reuseHours ?? getDiscoveryDetailReuseHours();
  if (!(reuseHours > 0)) return undefined;
  const runQuery = options.query ?? ((text: string, params: unknown[]) => sql.query(text, params) as Promise<unknown[]>);

  return async (cnpjs: string[]) => {
    const unique = Array.from(new Set(cnpjs.map((cnpj) => normalizeCnpj(cnpj)).filter(Boolean)));
    const found = new Map<string, StoredCasaDosDadosDetail>();
    if (unique.length === 0) return found;

    const minFetchedAt = new Date(Date.now() - reuseHours * 60 * 60 * 1000).toISOString();
    for (let start = 0; start < unique.length; start += MAX_CNPJS_PER_QUERY) {
      const chunk = unique.slice(start, start + MAX_CNPJS_PER_QUERY);
      // Comparação textual de ISO-8601 em UTC ("...Z") preserva a ordem cronológica
      // e evita cast que falharia em valores malformados.
      const rows = await runQuery(
        `SELECT cnpj,
                provider_payload -> 'casadosdados_detalhe' AS detail,
                provider_payload ->> '${CASA_DOS_DADOS_DETAIL_FETCHED_AT_KEY}' AS fetched_at
           FROM establishments
          WHERE cnpj = ANY($1)
            AND provider_payload ->> '${CASA_DOS_DADOS_DETAIL_FETCHED_AT_KEY}' >= $2`,
        [chunk, minFetchedAt]
      );
      for (const [cnpj, value] of parseStoredDetailRows(rows as Row[], minFetchedAt)) {
        found.set(cnpj, value);
      }
    }
    return found;
  };
}
