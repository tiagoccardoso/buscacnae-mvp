import { createDbClient } from "@/lib/db-client";
import { isFiniteCoordinate, isWithinBrazil, parseCoordinate } from "@/lib/map/geo";

/**
 * Cache de coordenadas POR EMPRESA (tabela opcional establishment_locations).
 *
 * É o passo 2 da estratégia de localização (lib/geo/company-location.ts): guarda
 * coordenadas de ponto já conhecidas — verificadas manualmente ("exact") ou vindas de
 * uma geocodificação de endereço ("address"). O BuscaCNAE não liga nenhum
 * geocodificador de endereço por padrão (custo e termos de uso); a tabela existe para
 * que uma futura integração grave aqui e o mapa passe a usar sem outra mudança.
 *
 * Sem a tabela (ou com o banco indisponível) devolve um mapa vazio: o mapa segue para
 * CEP → município → UF, sem erro.
 */
export type CachedCompanyLocation = {
  latitude: number;
  longitude: number;
  precision: "exact" | "address";
};

const CHUNK = 500;

export async function loadCompanyLocationCache(cnpjs: string[]): Promise<Map<string, CachedCompanyLocation>> {
  const found = new Map<string, CachedCompanyLocation>();
  const unique = Array.from(new Set(cnpjs.filter(Boolean)));
  if (unique.length === 0) return found;

  try {
    const db = createDbClient();
    for (let start = 0; start < unique.length; start += CHUNK) {
      const { data, error } = await db
        .from("establishment_locations")
        .select("cnpj, latitude, longitude, precision")
        .in("cnpj", unique.slice(start, start + CHUNK));
      if (error || !data) return found;
      for (const row of data as Array<Record<string, unknown>>) {
        const latitude = parseCoordinate(row.latitude);
        const longitude = parseCoordinate(row.longitude);
        const precision = row.precision === "exact" || row.precision === "address" ? row.precision : null;
        if (latitude === null || longitude === null || !precision) continue;
        if (!isFiniteCoordinate(latitude, longitude) || !isWithinBrazil(latitude, longitude)) continue;
        found.set(String(row.cnpj), { latitude, longitude, precision });
      }
    }
  } catch {
    // Tabela ausente ou banco indisponível: segue sem o cache.
  }
  return found;
}
