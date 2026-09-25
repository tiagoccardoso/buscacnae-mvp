import { companyFromSearchRow, type Company } from "@/lib/company-model";

/**
 * UNIVERSO ANALISADO — regra única da Lista, do Mapa e da Inteligência (Fase 3).
 *
 * Antes da Fase 3 a lista lia todas as linhas liberadas e o mapa lia no máximo
 * MAP_MAX_MARKERS, cada um com o seu contador. Agora as três visões recebem o
 * MESMO conjunto de empresas, montado por `buildAnalysisUniverse`, e exibem a MESMA
 * reconciliação de números:
 *
 *   informado pela Casa dos Dados   (search_queries.total_results)
 *   − não carregado na busca        (limite DISCOVERY_MAX_RESULTS / páginas)
 *   = gravado nesta busca           (linhas em search_results)
 *   − bloqueado até a compra        (antes do pagamento só 1 linha de amostra é liberada)
 *   − acima do teto de análise      (ANALYSIS_MAX_COMPANIES, padrão = MAP_MAX_MARKERS)
 *   − sem estabelecimento/CNPJ      (linha sem cadastro utilizável)
 *   − duplicado                     (mesmo estabelecimento repetido na busca)
 *   = UNIVERSO ANALISADO            (o que Lista, Mapa e Inteligência mostram)
 *
 * Depois disso só os FILTROS (compartilhados pela URL) reduzem o número, e cada
 * visão mostra "N de UNIVERSO". O mapa ainda informa quantas não têm localização
 * (continuam no universo e na lista, só não viram ponto).
 */
export type UniverseCounts = {
  /** Total informado pela Casa dos Dados para a consulta (pode ser maior que o gravado). */
  reported: number;
  /** Linhas gravadas em search_results para a busca. */
  stored: number;
  /** Lista liberada (pedido pago ou gratuito). */
  unlocked: boolean;
  /** Linhas bloqueadas até a compra (amostra de 1 antes do pagamento). */
  locked: number;
  /** Linhas liberadas, mas acima do teto de análise. */
  overLimit: number;
  /** Linhas sem estabelecimento ou sem CNPJ. */
  invalid: number;
  /** Estabelecimentos repetidos na mesma busca (contados uma vez). */
  duplicates: number;
  /** Empresas analisadas = universo. */
  analyzed: number;
  /** Teto de análise aplicado. */
  maxCompanies: number;
};

export type UniverseCompany = {
  company: Company;
  position: number;
  establishmentId: string;
};

export type AnalysisUniverse = {
  companies: UniverseCompany[];
  counts: UniverseCounts;
};

type SearchRow = { position?: unknown; establishment_id?: unknown; establishments?: unknown; provider_payload?: unknown };

/**
 * Função PURA (testável sem banco). `rows` são as linhas já na ordem de `position`.
 * - `stored`: total de linhas gravadas (count do banco); quando omitido, usa rows.length.
 * - `unlocked=false`: só a primeira linha é liberada (mesma regra de antes na lista e no mapa).
 * - `maxCompanies`: teto de análise (as primeiras N linhas liberadas pela posição).
 */
export function buildAnalysisUniverse(
  rows: readonly SearchRow[],
  options: { unlocked: boolean; maxCompanies: number; reported: number; stored?: number }
): AnalysisUniverse {
  const stored = Math.max(options.stored ?? rows.length, rows.length);
  const releasedLimit = options.unlocked ? stored : Math.min(1, stored);
  const locked = stored - releasedLimit;
  const maxCompanies = Math.max(1, Math.trunc(options.maxCompanies));
  const overLimit = Math.max(0, releasedLimit - maxCompanies);
  const considered = rows.slice(0, Math.min(releasedLimit, maxCompanies));

  const seen = new Set<string>();
  const companies: UniverseCompany[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const row of considered) {
    const company = companyFromSearchRow(row);
    if (!company || !company.cnpj) {
      invalid += 1;
      continue;
    }
    const establishmentId = String(row.establishment_id ?? company.id);
    const identity = company.id || establishmentId;
    if (seen.has(identity)) {
      duplicates += 1;
      continue;
    }
    seen.add(identity);
    companies.push({ company, position: Number(row.position ?? companies.length + 1) || companies.length + 1, establishmentId });
  }

  // Linhas liberadas que o chamador não carregou (ex.: rows truncado) contam como fora do teto.
  const missing = Math.max(0, Math.min(releasedLimit, maxCompanies) - considered.length);

  return {
    companies,
    counts: {
      reported: Math.max(0, Math.trunc(options.reported) || 0),
      stored,
      unlocked: options.unlocked,
      locked,
      overLimit: overLimit + missing,
      invalid,
      duplicates,
      analyzed: companies.length,
      maxCompanies
    }
  };
}

/** Quantas linhas buscar no banco para montar o universo. */
export function universeRowLimit(unlocked: boolean, maxCompanies: number) {
  return unlocked ? Math.max(1, Math.trunc(maxCompanies)) : 1;
}

/**
 * Invariante da reconciliação (testada): stored = locked + overLimit + invalid + duplicates + analyzed.
 */
export function reconcileUniverse(counts: UniverseCounts) {
  return counts.locked + counts.overLimit + counts.invalid + counts.duplicates + counts.analyzed === counts.stored;
}

export type UniverseNote = { key: string; count: number; text: string };

/** Explicações (em ordem) de por que o universo difere do total informado. Só itens > 0. */
export function describeUniverse(counts: UniverseCounts): UniverseNote[] {
  const notes: UniverseNote[] = [];
  const notStored = Math.max(0, counts.reported - counts.stored);
  if (notStored > 0)
    notes.push({
      key: "not-stored",
      count: notStored,
      text: "informadas pela Casa dos Dados, mas não carregadas nesta busca (limite de resultados por busca)"
    });
  if (counts.locked > 0) notes.push({ key: "locked", count: counts.locked, text: "liberadas somente após a compra da lista" });
  if (counts.overLimit > 0)
    notes.push({ key: "over-limit", count: counts.overLimit, text: `acima do teto de análise (${counts.maxCompanies} empresas por busca)` });
  if (counts.invalid > 0) notes.push({ key: "invalid", count: counts.invalid, text: "sem cadastro ou CNPJ utilizável" });
  if (counts.duplicates > 0) notes.push({ key: "duplicates", count: counts.duplicates, text: "repetidas na busca (contadas uma vez)" });
  return notes;
}
