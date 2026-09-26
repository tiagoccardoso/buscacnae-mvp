import type { CompanySearchFilters } from "@/lib/search/company-index";
import { interpretQuery, type QueryInterpretation } from "@/lib/search/query-understanding";
import { QUERY_FILLER_WORDS } from "@/lib/search/text";

/**
 * Converte o texto livre em (texto + filtros exatos) antes de ir ao índice.
 *
 * Regra definida pelo benchmark (docs/BUSCA_AVANCADA.md §5): só vira filtro o que é
 * INEQUÍVOCO.
 *   - CNPJ completo/raiz → filtro exato (o índice nunca aproxima identificadores).
 *   - Código CNAE digitado → filtro de CNAE principal.
 *   - Sigla de UF no fim da consulta ("... pr") → filtro de UF.
 * Cidade e atividade reconhecidas NÃO filtram silenciosamente: sobrenomes brasileiros
 * são nomes de cidade (Teixeira, Oliveira, Nova Era, Serra, Conceição…) e o filtro
 * automático derrubou o recall de 0,94 para 0,76 no benchmark. Elas voltam como
 * SUGESTÕES para a interface (o usuário escolhe aplicar), e o próprio índice já encontra
 * "pato brnaco" no atributo cidade com tolerância a erro.
 * Filtros escolhidos pelo usuário sempre prevalecem.
 */
export type CompanyQueryPlan = {
  q: string;
  filters: CompanySearchFilters;
  interpretation: QueryInterpretation;
  inferred: { state: boolean; cnpj: boolean; cnae: boolean };
};

export function planCompanyQuery(rawQuery: string, userFilters: CompanySearchFilters = {}): CompanyQueryPlan {
  const interpretation = interpretQuery(rawQuery);
  const filters: CompanySearchFilters = { ...userFilters };
  const inferred = { state: false, cnpj: false, cnae: false };

  if (interpretation.cnpj) {
    inferred.cnpj = true;
    if (interpretation.cnpj.kind === "full") {
      filters.cnpj = interpretation.cnpj.value;
      return { q: "", filters, interpretation, inferred };
    }
    if (interpretation.cnpj.kind === "root") {
      filters.cnpjRoot = interpretation.cnpj.value;
      return { q: "", filters, interpretation, inferred };
    }
    // Prefixo de CNPJ: busca por prefixo no atributo cnpj (tolerância a erro desligada em números).
    return { q: interpretation.cnpj.value, filters, interpretation, inferred };
  }

  if (!interpretation.normalized) return { q: "", filters, interpretation, inferred };

  const typedCnaeCode = interpretation.residualText === "" && interpretation.cnaes.length > 0 && !interpretation.municipality;
  if (typedCnaeCode) {
    const exact = interpretation.cnaes.filter((candidate) => candidate.score >= 100).map((candidate) => candidate.code);
    if (!filters.primaryCnaes?.length) filters.primaryCnaes = exact.length > 0 ? exact : interpretation.cnaes.map((candidate) => candidate.code);
    inferred.cnae = true;
    return { q: "", filters, interpretation, inferred };
  }

  let tokens = interpretation.normalized.split(" ");
  if (interpretation.stateSource === "sigla" && interpretation.stateCode) {
    tokens = tokens.slice(0, -1);
    if (!filters.stateCodes?.length) {
      filters.stateCodes = [interpretation.stateCode];
      inferred.state = true;
    }
  }
  const q = tokens.filter((token) => !QUERY_FILLER_WORDS.has(token)).join(" ");
  return { q, filters, interpretation, inferred };
}
