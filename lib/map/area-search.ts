import { boundsAreaKm2, normalizeBounds } from "@/lib/map/geo";
import type { GeoBounds } from "@/lib/map/types";

/**
 * "Buscar nesta área" — estratégia (documentada em docs/MAPA_EMPRESARIAL.md):
 *
 * A pesquisa da Casa dos Dados (POST /v5/cnpj/pesquisa) NÃO aceita latitude/longitude,
 * raio ou bounding box; aceita uf, municipio, bairro e cep. Por isso a área visível
 * não é enviada como geometria (isso seria simular um recurso inexistente):
 *
 * 1. calculamos o retângulo visível no navegador (ação explícita do usuário);
 * 2. no servidor, selecionamos os municípios cuja sede IBGE está dentro do retângulo;
 * 3. se a área tiver municípios demais (ou for grande demais), pedimos para aproximar;
 * 4. executamos a busca normal (prepareSearchOrder) com os mesmos CNAEs e filtros da
 *    busca de origem, trocando apenas a localidade pelos municípios encontrados;
 * 5. o resultado é uma nova busca salva no histórico, exibida em Lista e Mapa.
 *
 * Não há filtragem geográfica adicional no resultado: a Casa dos Dados só fornece
 * coordenada em nível de município, então todas as empresas dos municípios escolhidos
 * pertencem à área por definição (a sede está no retângulo). Só filtraríamos por
 * coordenada se houvesse precisão de endereço confiável.
 */
export const AREA_SEARCH_MAX_AREA_KM2 = 250_000;

export type AreaCandidate = { name: string; stateCode: string; latitude: number; longitude: number };

export type AreaSearchPlan =
  | { kind: "cities"; cities: Array<{ cityName: string; stateCode: string }>; stateCodes: string[] }
  | { kind: "too_large"; reason: "area" | "cities"; candidates: number }
  | { kind: "empty" }
  | { kind: "invalid" };

export function planAreaSearch(
  rawBounds: GeoBounds,
  findCandidates: (bounds: GeoBounds) => readonly AreaCandidate[],
  maxCities: number
): AreaSearchPlan {
  const bounds = normalizeBounds(rawBounds);
  if (!bounds) return { kind: "invalid" };

  if (boundsAreaKm2(bounds) > AREA_SEARCH_MAX_AREA_KM2) {
    return { kind: "too_large", reason: "area", candidates: 0 };
  }

  const candidates = findCandidates(bounds);
  if (candidates.length === 0) return { kind: "empty" };
  if (candidates.length > maxCities) return { kind: "too_large", reason: "cities", candidates: candidates.length };

  const cities = candidates.map((item) => ({ cityName: item.name, stateCode: item.stateCode }));
  const stateCodes = Array.from(new Set(cities.map((item) => item.stateCode)));
  return { kind: "cities", cities, stateCodes };
}

export function describeAreaSearchPlan(plan: AreaSearchPlan): string {
  switch (plan.kind) {
    case "too_large":
      return plan.reason === "cities"
        ? `A área visível tem ${plan.candidates} municípios. Aproxime o mapa para buscar em uma região menor.`
        : "A área visível é muito ampla. Aproxime o mapa para buscar em uma região menor.";
    case "empty":
      return "Nenhum município encontrado nesta região. Mova o mapa para uma área com cidades.";
    case "invalid":
      return "Não foi possível identificar a área visível. Tente mover o mapa novamente.";
    default:
      return "";
  }
}
