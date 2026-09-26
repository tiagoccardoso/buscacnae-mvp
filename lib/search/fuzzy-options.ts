import { searchCnaeOptions, type CnaeOption } from "@/lib/cnae-options";
import { rankCnaesForTerms } from "@/lib/search/query-understanding";
import { PT_STOP_WORDS, allowedTypos, boundedEditDistance, foldSearchText } from "@/lib/search/text";

/**
 * Fallbacks tolerantes a erro para os seletores do formulário de busca (Fase 7).
 * Só entram quando a busca exata atual não encontra nada — o comportamento existente
 * (e a ordem dos resultados que ele já dá) não muda.
 */

/** "trasnportadora" → CNAEs de transporte, com os mesmos rótulos do catálogo oficial. */
export async function fuzzyCnaeOptions(query: string, limit: number): Promise<CnaeOption[]> {
  const terms = foldSearchText(query)
    .split(" ")
    .filter((term) => term.length >= 3 && !PT_STOP_WORDS.has(term));
  if (terms.length === 0) return [];
  const ranked = rankCnaesForTerms(terms, limit).filter((candidate) => candidate.score >= 1.5);
  if (ranked.length === 0) return [];
  return searchCnaeOptions({ ids: ranked.map((candidate) => candidate.code), limit });
}

/** Cidades com até 1–2 erros de digitação ("pato brnaco", "curitba"), inclusive como prefixo. */
export function fuzzyFilterByName<T extends { cityName: string }>(items: T[], query: string, limit: number): T[] {
  const needle = foldSearchText(query);
  if (needle.length < 3) return [];
  const budget = Math.max(1, allowedTypos(needle.replace(/\s/g, "").length));
  return items
    .map((item) => {
      const name = foldSearchText(item.cityName);
      const whole = boundedEditDistance(needle, name, budget);
      const prefix = name.length > needle.length ? boundedEditDistance(needle, name.slice(0, needle.length), budget) : whole;
      return { item, distance: Math.min(whole, prefix + 0.5) };
    })
    .filter(({ distance }) => distance <= budget)
    .sort((left, right) => left.distance - right.distance || left.item.cityName.localeCompare(right.item.cityName, "pt-BR"))
    .slice(0, limit)
    .map(({ item }) => item);
}
