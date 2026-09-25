import type { createDbClient } from "@/lib/db-client";
import type { NormalizedEstablishment } from "@/lib/types";

/**
 * Persistência dos resultados da pesquisa (establishments + search_results).
 *
 * Antes, `prepareSearchOrder` e `runDiscoverySearch` repetiam o mesmo mapeamento,
 * gravavam tudo em um único INSERT (29 parâmetros por linha: acima de ~2.200 linhas
 * o PostgreSQL recusa por exceder 65.535 parâmetros), devolviam `RETURNING *`
 * (payload bruto inteiro de volta) e ainda faziam um SELECT extra para obter os ids.
 * Agora: lotes de tamanho fixo e `RETURNING id, cnpj`.
 */
type DbClient = ReturnType<typeof createDbClient>;

export const PERSISTENCE_CHUNK_SIZE = 500;

export function chunk<T>(items: T[], size = PERSISTENCE_CHUNK_SIZE): T[][] {
  const safeSize = Math.max(1, Math.trunc(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

export function toEstablishmentRecord(row: NormalizedEstablishment) {
  return {
    cnpj: row.cnpj,
    cnpj_root: row.cnpjRoot,
    company_name: row.companyName,
    trade_name: row.tradeName,
    registration_status: row.registrationStatus,
    opened_at: row.openedAt,
    primary_cnae_code: row.primaryCnaeCode,
    primary_cnae_description: row.primaryCnaeDescription,
    secondary_cnaes: row.secondaryCnaes,
    legal_nature_code: row.legalNatureCode,
    legal_nature_description: row.legalNatureDescription,
    company_size: row.companySize,
    simples_opt_in: row.simplesOptIn,
    mei_opt_in: row.meiOptIn,
    capital_social: row.capitalSocial,
    email: row.email,
    phone: row.phone,
    website: row.website,
    country: row.country,
    state_code: row.stateCode,
    city_name: row.cityName,
    city_ibge: row.cityIbge,
    neighborhood: row.neighborhood,
    cep: row.cep,
    address_line: row.addressLine,
    address_number: row.addressNumber,
    complement: row.complement,
    provider_payload: row.providerPayload
  };
}

/** Upsert em lotes; devolve o mapa cnpj → id do estabelecimento. */
export async function upsertEstablishments(db: DbClient, rows: NormalizedEstablishment[]) {
  const ids = new Map<string, string>();
  for (const part of chunk(rows)) {
    const { data, error } = await db
      .from("establishments")
      .upsert(part.map(toEstablishmentRecord), { onConflict: "cnpj" })
      .select("id, cnpj");
    if (error) throw error;
    for (const item of (data ?? []) as Array<{ id: unknown; cnpj: unknown }>) {
      if (item?.cnpj && item?.id) ids.set(String(item.cnpj), String(item.id));
    }
  }
  return ids;
}

export async function insertSearchResults(
  db: DbClient,
  input: {
    searchQueryId: string;
    profileId: string | null;
    rows: NormalizedEstablishment[];
    establishmentIds: Map<string, string>;
  }
) {
  const payload = input.rows
    .map((row, index) => {
      const establishmentId = input.establishmentIds.get(row.cnpj);
      if (!establishmentId) return null;
      return {
        search_query_id: input.searchQueryId,
        profile_id: input.profileId,
        establishment_id: establishmentId,
        position: index + 1,
        provider_payload: row.providerPayload
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  for (const part of chunk(payload)) {
    const { error } = await db.from("search_results").insert(part).select("establishment_id");
    if (error) throw error;
  }
  return payload.length;
}
