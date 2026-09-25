import { NOT_INFORMED, foldText, formatCnaeCode, sizeKey, statusKey } from "@/lib/analytics/dimensions";
import { buildFilterLabelMaps } from "@/lib/analytics/labels";
import { keysOf, type AnalyticsRecord } from "@/lib/analytics/metrics";
import { searchCnaeOptions } from "@/lib/cnae-options";
import { listMunicipalities, normalizePlaceName, type Municipality } from "@/lib/geo/municipalities";
import type { SpecLabelLookup } from "@/lib/ai/filters";

/**
 * Vocabulário do universo + resolução de ENTIDADES (servidor).
 *
 * O planejador (modelo ou regras) só menciona entidades em texto ("Cascavel", "Paraná",
 * "contabilidade", "ME"). Aqui elas viram chaves reais (IBGE, UF, CNAE de 7 dígitos,
 * chave de porte) de forma determinística, priorizando o que existe nos dados da busca.
 * O modelo nunca escreve um código IBGE/CNAE que o sistema use sem conferir.
 */

export const UF_NAMES: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins"
};

const UF_BY_NAME = new Map(Object.entries(UF_NAMES).map(([uf, name]) => [foldText(name), uf]));

export type Vocabulary = {
  labels: SpecLabelLookup;
  /** Municípios presentes no universo (IBGE → contagem). */
  municipalityCounts: Map<string, number>;
  stateCounts: Map<string, number>;
  /** CNAEs presentes no universo (código → descrição). */
  cnaes: Map<string, string>;
  cnaeCounts: Map<string, number>;
  sizeCounts: Map<string, number>;
  statusCounts: Map<string, number>;
};

export function buildVocabulary(records: readonly AnalyticsRecord[]): Vocabulary {
  const maps = buildFilterLabelMaps(records);
  const municipalityCounts = new Map<string, number>();
  const stateCounts = new Map<string, number>();
  const cnaeCounts = new Map<string, number>();
  const sizeCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const cnaes = new Map<string, string>();
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const record of records) {
    const keys = keysOf(record);
    bump(municipalityCounts, keys.municipality);
    bump(stateCounts, keys.state);
    bump(cnaeCounts, keys.cnae);
    bump(sizeCounts, keys.size);
    bump(statusCounts, keys.status);
    if (keys.cnae !== NOT_INFORMED && !cnaes.has(keys.cnae)) cnaes.set(keys.cnae, record.cnaeDescription ?? "");
  }
  return {
    labels: { municipality: maps.municipality, cnae: maps.cnae, size: maps.size, status: maps.status },
    municipalityCounts,
    stateCounts,
    cnaes,
    cnaeCounts,
    sizeCounts,
    statusCounts
  };
}

/* ------------------------------------------------------------------ UF */

export function resolveState(mention: string): string | null {
  const raw = mention.trim();
  if (/^[A-Za-z]{2}$/.test(raw) && UF_NAMES[raw.toUpperCase()]) return raw.toUpperCase();
  const folded = foldText(raw).replace(/^(estado d[eo]s?|estado)\s+/, "");
  return UF_BY_NAME.get(folded) ?? null;
}

/* ------------------------------------------------------------------ município */

let nameIndex: Map<string, Municipality[]> | null = null;

function municipalitiesByName() {
  if (nameIndex) return nameIndex;
  nameIndex = new Map();
  for (const item of listMunicipalities()) {
    const key = normalizePlaceName(item.name);
    const list = nameIndex.get(key);
    if (list) list.push(item);
    else nameIndex.set(key, [item]);
  }
  return nameIndex;
}

/** Nomes de municípios (normalizados) — usado pelo intérprete por regras para localizar menções. */
export function hasMunicipalityName(normalized: string) {
  return municipalitiesByName().has(normalized);
}

export function municipalityLabel(item: Municipality) {
  return `${item.name}/${item.stateCode}`;
}

export type CityResolution =
  | { status: "ok"; ibge: string; label: string; inUniverse: boolean; note: string | null }
  | { status: "ambiguous"; mention: string; options: Array<{ ibge: string; label: string; inUniverse: boolean }> }
  | { status: "not_found"; mention: string };

/**
 * "Cascavel" → Cascavel/PR ou Cascavel/CE? Preferência, nesta ordem:
 * UF escrita na menção ("Cascavel/PR") → presente no universo → UF do contexto
 * (filtro de UF ou outras cidades citadas) → senão, ambíguo (pergunta ao usuário).
 */
export function resolveCity(mention: string, vocabulary: Vocabulary, preferredStates: readonly string[] = []): CityResolution {
  const cleaned = mention.trim();
  const ibge = cleaned.replace(/\D/g, "");
  if (/^\d{7}$/.test(cleaned) || (ibge.length === 7 && /^[\d.\-\s]+$/.test(cleaned))) {
    const found = listMunicipalities().find((item) => item.ibge === ibge);
    return found
      ? { status: "ok", ibge, label: municipalityLabel(found), inUniverse: vocabulary.municipalityCounts.has(ibge), note: null }
      : { status: "not_found", mention: cleaned };
  }

  let name = cleaned;
  let state: string | null = null;
  const withState = /^(.*?)\s*(?:\/|-|,|\(|\s)\s*([A-Za-z]{2})\)?$/.exec(cleaned);
  if (withState && UF_NAMES[withState[2].toUpperCase()] && withState[1].trim()) {
    name = withState[1];
    state = withState[2].toUpperCase();
  }
  const normalized = normalizePlaceName(name.replace(/^(cidade|municipio|município)\s+de\s+/i, ""));
  let candidates = municipalitiesByName().get(normalized) ?? [];
  if (state) candidates = candidates.filter((item) => item.stateCode === state);
  if (candidates.length === 0) return { status: "not_found", mention: cleaned };

  const option = (item: Municipality) => ({ ibge: item.ibge, label: municipalityLabel(item), inUniverse: vocabulary.municipalityCounts.has(item.ibge) });
  if (candidates.length === 1) return { status: "ok", ...option(candidates[0]), note: null };

  const inUniverse = candidates.filter((item) => vocabulary.municipalityCounts.has(item.ibge));
  if (inUniverse.length === 1) {
    return { status: "ok", ...option(inUniverse[0]), note: `“${cleaned}” existe em ${candidates.length} UFs; usei ${municipalityLabel(inUniverse[0])}, a única presente nesta busca.` };
  }
  const pool = inUniverse.length > 1 ? inUniverse : candidates;
  const preferred = pool.filter((item) => preferredStates.includes(item.stateCode));
  if (preferred.length === 1) {
    return { status: "ok", ...option(preferred[0]), note: `“${cleaned}” existe em ${candidates.length} UFs; usei ${municipalityLabel(preferred[0])} pelo contexto (${preferred[0].stateCode}).` };
  }
  return { status: "ambiguous", mention: cleaned, options: pool.slice(0, 8).map(option) };
}

/* ------------------------------------------------------------------ CNAE / atividade */

const ACTIVITY_STOP = new Set([
  "empresa",
  "empresas",
  "atividade",
  "atividades",
  "setor",
  "ramo",
  "servico",
  "servicos",
  "comercio",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "para",
  "com",
  "outros",
  "outras",
  "geral"
]);

/** Sinônimos curtos → radicais que aparecem nas descrições oficiais de CNAE. */
const ACTIVITY_SYNONYMS: Record<string, string[]> = {
  contador: ["contabil"],
  contadores: ["contabil"],
  contabeis: ["contabil"],
  contabilidade: ["contabil"],
  escritorios: ["contabil"],
  dentista: ["odontolog"],
  dentistas: ["odontolog"],
  odontologia: ["odontolog"],
  roupas: ["vestuario"],
  roupa: ["vestuario"],
  advocacia: ["juridic"],
  advogados: ["juridic"],
  software: ["programas", "computador"],
  ti: ["informacao", "computador"],
  mercados: ["minimercado", "mercadorias"],
  mercadinho: ["minimercado"],
  salao: ["cabeleireir"],
  saloes: ["cabeleireir"],
  cabeleireiro: ["cabeleireir"],
  construtora: ["construcao"],
  construtoras: ["construcao"],
  transportadora: ["transporte"],
  transportadoras: ["transporte"],
  restaurante: ["restaurant"],
  restaurantes: ["restaurant"]
};

function stems(text: string) {
  const out: string[][] = [];
  for (const token of foldText(text).split(/[^a-z0-9]+/)) {
    if (token.length < 3 || ACTIVITY_STOP.has(token)) continue;
    const synonyms = ACTIVITY_SYNONYMS[token];
    const base = token.length > 6 ? token.slice(0, token.length - 2) : token;
    out.push(synonyms ? [base, ...synonyms] : [base]);
  }
  return out;
}

export type ActivityResolution =
  | { status: "ok"; cnaes: string[]; inUniverse: boolean; note: string | null }
  | { status: "not_found"; mention: string };

/**
 * Atividade → CNAEs. Código explícito ("6920-6/01") é usado como está. Texto é comparado
 * com as descrições dos CNAEs PRESENTES na busca; sem correspondência, cai no catálogo
 * oficial (resultado 0 empresas nesta busca, com aviso).
 */
export async function resolveActivity(mention: string, vocabulary: Vocabulary): Promise<ActivityResolution> {
  const digits = mention.replace(/\D/g, "");
  if (digits.length === 7 && /^[\d.\-/\s]+$/.test(mention.trim())) {
    return { status: "ok", cnaes: [digits], inUniverse: vocabulary.cnaes.has(digits), note: null };
  }

  const tokenStems = stems(mention);
  if (tokenStems.length === 0) return { status: "not_found", mention };

  // Pontuação: radical do próprio termo (peso 2) > sinônimo (peso 1). "contabilidade" casa
  // "Atividades de contabilidade" (termo) antes de "…auditoria contábil" (sinônimo).
  let best = 0;
  let matches: string[] = [];
  const related: string[] = [];
  for (const [code, description] of vocabulary.cnaes) {
    const words = foldText(description).split(/[^a-z0-9]+/);
    let score = 0;
    let covered = 0;
    for (const [base, ...synonyms] of tokenStems) {
      if (words.some((word) => word.startsWith(base))) {
        score += 2;
        covered += 1;
      } else if (synonyms.some((stem) => words.some((word) => word.startsWith(stem)))) {
        score += 1;
        covered += 1;
      }
    }
    if (covered < Math.ceil(tokenStems.length / 2)) continue;
    if (score > best) {
      related.push(...matches);
      best = score;
      matches = [code];
    } else if (score === best) matches.push(code);
    else related.push(code);
  }
  if (best > 0) {
    const byCount = (left: string, right: string) => (vocabulary.cnaeCounts.get(right) ?? 0) - (vocabulary.cnaeCounts.get(left) ?? 0) || left.localeCompare(right);
    const sorted = matches.sort(byCount).slice(0, 12);
    const labels = sorted.map((code) => vocabulary.labels.cnae.get(code) ?? formatCnaeCode(code));
    const others = related.sort(byCount).slice(0, 4).map((code) => vocabulary.labels.cnae.get(code) ?? formatCnaeCode(code));
    return {
      status: "ok",
      cnaes: sorted,
      inUniverse: true,
      note: `“${mention.trim()}” → ${labels.join("; ")}.${others.length > 0 ? ` Relacionados não incluídos: ${others.join("; ")} (cite o código para incluir).` : ""}`
    };
  }

  // Catálogo oficial: só entram resultados cuja descrição contém os radicais da menção
  // (o ranking do catálogo expande sinônimos e pode trazer atividades vizinhas).
  const catalog = (await searchCnaeOptions({ query: mention, limit: 12 }))
    .filter((item) => {
      const words = foldText(item.label).split(/[^a-z0-9]+/);
      return tokenStems.every((alternatives) => alternatives.some((stem) => words.some((word) => word.startsWith(stem))));
    })
    .slice(0, 3);
  if (catalog.length > 0) {
    const codes = catalog.map((item) => item.value).filter((code) => /^\d{7}$/.test(code));
    if (codes.length > 0) {
      return {
        status: "ok",
        cnaes: codes.slice(0, 3),
        inUniverse: codes.some((code) => vocabulary.cnaes.has(code)),
        note: `“${mention.trim()}” → catálogo oficial: ${catalog.map((item) => item.label).join("; ")}.`
      };
    }
  }
  return { status: "not_found", mention };
}

/* ------------------------------------------------------------------ porte e situação */

const SIZE_SYNONYMS: Array<{ keys: string[]; patterns: RegExp }> = [
  { keys: ["me", "microempresa", "micro-empresa"], patterns: /^(me|micro|microempresas?|micro empresas?)$/ },
  { keys: ["epp", "empresa-de-pequeno-porte", "pequeno-porte"], patterns: /^(epp|pequeno porte|empresas? de pequeno porte|pequenas?)$/ },
  { keys: ["mei", "microempreendedor-individual"], patterns: /^(mei|microempreendedor individual|microempreendedores?)$/ },
  { keys: ["demais", "grande", "medio", "media"], patterns: /^(demais|grandes?|medias?|medios?|grande porte|medio porte)$/ }
];

export function resolveSize(mention: string, vocabulary: Vocabulary): { key: string; inUniverse: boolean } | null {
  const folded = foldText(mention);
  const direct = sizeKey(mention);
  if (vocabulary.sizeCounts.has(direct) && direct !== NOT_INFORMED) return { key: direct, inUniverse: true };
  for (const entry of SIZE_SYNONYMS) {
    if (!entry.patterns.test(folded) && !entry.keys.includes(direct)) continue;
    const present = entry.keys.find((key) => vocabulary.sizeCounts.has(key));
    return { key: present ?? entry.keys[0], inUniverse: Boolean(present) };
  }
  return null;
}

export function resolveStatus(mention: string): string | null {
  const folded = foldText(mention);
  if (/^(ativas?|em atividade)$/.test(folded)) return "active";
  if (/^(inativas?|nao ativas?|encerradas?|fechadas?)$/.test(folded)) return "inactive";
  const singular = folded.replace(/s$/, "");
  if (["baixada", "inapta", "suspensa", "nula"].includes(singular)) return statusKey(singular);
  return null;
}
