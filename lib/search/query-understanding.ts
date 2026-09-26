import rawCatalog from "@/data/cnae-catalog.json";
import { formatCnaeCode, normalizeCnaeCode } from "@/lib/cnae-utils";
import { BRAZILIAN_UFS, normalizeUf } from "@/lib/data-quality/normalize";
import { listMunicipalities, type Municipality } from "@/lib/geo/municipalities";
import {
  PT_STOP_WORDS,
  QUERY_FILLER_WORDS,
  allowedTypos,
  boundedEditDistance,
  detectCnpjQuery,
  foldSearchText,
  lightStem,
  tokenizeSearchText
} from "@/lib/search/text";

/**
 * Intérprete local de consultas em texto livre (Fase 7).
 *
 * "transportadoras pato brnaco" → CNAE 4930-2/0x (transporte rodoviário de carga)
 * + Pato Branco/PR, apesar do erro de digitação.
 *
 * Roda em memória sobre dois catálogos PÚBLICOS e já presentes no projeto
 * (CNAE/CONCLA e municípios/IBGE). Não depende do Meilisearch: o benchmark da Fase 7
 * mostrou que, para ~1,3 mil CNAEs e ~5,6 mil municípios, o processamento local é
 * mais rápido que uma ida ao índice e não precisa de sincronização. Por isso ele é
 * também o fallback natural quando o mecanismo de busca está indisponível.
 *
 * O resultado é só uma INTERPRETAÇÃO: quem busca empresas continua sendo a Casa dos Dados.
 */

type RawCatalogEntry = {
  code: string;
  description: string;
  classCode: string;
  classDescription: string;
  groupDescription: string;
  divisionDescription: string;
};

export type CnaeCandidate = {
  code: string;
  formattedCode: string;
  label: string;
  classCode: string;
  score: number;
  matchedTerms: string[];
};

export type MunicipalityMatch = {
  name: string;
  stateCode: string;
  ibge: string;
  matchedText: string;
  distance: number;
  /** "high": seguro para virar filtro. "low": só sugestão (mantém o texto na busca). */
  confidence: "high" | "low";
};

export type QueryInterpretation = {
  query: string;
  normalized: string;
  cnpj: { kind: "full" | "root" | "prefix"; value: string } | null;
  stateCode: string | null;
  /** De onde veio a UF: sigla digitada no fim, nome do estado por extenso ou cidade reconhecida. */
  stateSource: "sigla" | "nome" | "cidade" | null;
  municipality: MunicipalityMatch | null;
  /** Outras cidades com o mesmo nome/aproximação (ex.: "Bom Jesus" existe em vários estados). */
  municipalityAlternatives: MunicipalityMatch[];
  cnaes: CnaeCandidate[];
  /** Termos de atividade que não foram consumidos por cidade/UF. */
  activityTerms: string[];
  /** Texto a ser usado na busca textual de empresas (sem cidade/UF já convertidas em filtro). */
  residualText: string;
};

/** Sinônimos de negócio → termos da descrição oficial do CNAE. */
const ACTIVITY_ALIASES: Record<string, string[]> = {
  transportadora: ["transporte", "rodoviario", "carga"],
  transportadoras: ["transporte", "rodoviario", "carga"],
  frete: ["transporte", "carga"],
  fretes: ["transporte", "carga"],
  logistica: ["transporte", "armazenamento", "carga"],
  mudanca: ["mudancas"],
  mudancas: ["mudancas"],
  oficina: ["manutencao", "reparacao", "veiculos"],
  oficinas: ["manutencao", "reparacao", "veiculos"],
  mecanica: ["manutencao", "reparacao", "mecanica"],
  mecanico: ["manutencao", "reparacao", "mecanica"],
  borracharia: ["borracharia"],
  supermercado: ["supermercados"],
  mercado: ["minimercados", "mercearias", "armazens"],
  mercados: ["minimercados", "mercearias", "armazens"],
  mercearia: ["mercearias"],
  hotel: ["hoteis"],
  hoteis: ["hoteis"],
  pousada: ["pensoes", "alojamento"],
  farmacia: ["varejista", "farmaceuticos"],
  farmacias: ["varejista", "farmaceuticos"],
  drogaria: ["varejista", "farmaceuticos"],
  padaria: ["padaria", "confeitaria", "revenda"],
  padarias: ["padaria", "confeitaria", "revenda"],
  dentista: ["odontologica"],
  dentistas: ["odontologica"],
  odontologia: ["odontologica"],
  clinica: ["ambulatorial", "clinica"],
  clinicas: ["ambulatorial", "clinica"],
  medico: ["medica", "ambulatorial"],
  advogado: ["advocaticios"],
  advogados: ["advocaticios"],
  advocacia: ["advocaticios"],
  contador: ["contabilidade"],
  contadores: ["contabilidade"],
  contabil: ["contabilidade"],
  escola: ["ensino"],
  escolas: ["ensino"],
  academia: ["condicionamento", "fisico"],
  academias: ["condicionamento", "fisico"],
  salao: ["cabeleireiros", "beleza"],
  saloes: ["cabeleireiros", "beleza"],
  barbearia: ["cabeleireiros"],
  pet: ["animais", "estimacao"],
  petshop: ["animais", "estimacao"],
  veterinaria: ["veterinarias"],
  veterinario: ["veterinarias"],
  lanchonete: ["lanchonetes"],
  bar: ["bares"],
  bares: ["bares"],
  pizzaria: ["restaurantes", "alimentacao"],
  construtora: ["construcao", "edificios"],
  construtoras: ["construcao", "edificios"],
  imobiliaria: ["imobiliarios", "corretagem"],
  imobiliarias: ["imobiliarios", "corretagem"],
  software: ["programas", "computador"],
  ti: ["tecnologia", "informacao"],
  informatica: ["informatica", "computador"],
  grafica: ["impressao"],
  graficas: ["impressao"],
  autoescola: ["formacao", "condutores"],
  lavanderia: ["lavanderias"],
  posto: ["combustiveis"],
  postos: ["combustiveis"],
  combustivel: ["combustiveis"],
  loja: ["varejista"],
  lojas: ["varejista"],
  atacado: ["atacadista"],
  distribuidora: ["atacadista"],
  distribuidoras: ["atacadista"],
  industria: ["fabricacao"],
  industrias: ["fabricacao"],
  fabrica: ["fabricacao"]
};

type IndexedCnae = {
  code: string;
  formattedCode: string;
  label: string;
  classCode: string;
  words: string[];
  stems: string[];
  contextWords: Set<string>;
  searchText: string;
};

type IndexedMunicipality = Municipality & { folded: string; tokenCount: number };

let cnaeIndex: IndexedCnae[] | null = null;
let cnaeWordFrequency: Map<string, number> | null = null;
let municipalityByFirstChar: Map<string, IndexedMunicipality[]> | null = null;

function meaningfulWords(text: string) {
  return tokenizeSearchText(text).filter((word) => word.length >= 3 && !PT_STOP_WORDS.has(word));
}

function ensureCnaeIndex() {
  if (cnaeIndex) return cnaeIndex;
  const frequency = new Map<string, number>();
  cnaeIndex = (rawCatalog as RawCatalogEntry[]).map((entry) => {
    const code = normalizeCnaeCode(entry.code);
    const words = Array.from(new Set(meaningfulWords(entry.description)));
    for (const word of words) frequency.set(word, (frequency.get(word) ?? 0) + 1);
    const context = new Set(meaningfulWords(`${entry.classDescription} ${entry.groupDescription}`));
    return {
      code,
      formattedCode: formatCnaeCode(code),
      label: `${formatCnaeCode(code)} · ${entry.description}`,
      classCode: normalizeCnaeCode(entry.classCode),
      words,
      stems: words.map((word) => lightStem(word)),
      contextWords: context,
      searchText: foldSearchText(entry.description)
    };
  });
  cnaeWordFrequency = frequency;
  return cnaeIndex;
}

function ensureMunicipalityIndex() {
  if (municipalityByFirstChar) return municipalityByFirstChar;
  const map = new Map<string, IndexedMunicipality[]>();
  for (const item of listMunicipalities()) {
    const folded = foldSearchText(item.name);
    if (!folded) continue;
    const entry: IndexedMunicipality = { ...item, folded, tokenCount: folded.split(" ").length };
    const bucket = map.get(folded[0]) ?? [];
    bucket.push(entry);
    map.set(folded[0], bucket);
  }
  municipalityByFirstChar = map;
  return map;
}

/** Peso de um termo: palavras raras no catálogo valem mais que "comércio"/"serviços". */
function termWeight(word: string) {
  const frequency = cnaeWordFrequency?.get(word) ?? 1;
  return 1 + Math.log(1334 / (1 + frequency));
}

function wordMatchesTerm(word: string, stem: string, term: string, termStem: string) {
  if (word === term) return 1;
  if (termStem.length >= 4 && (word.startsWith(termStem) || stem === termStem)) return 0.9;
  const budget = allowedTypos(term.length);
  if (budget > 0 && word[0] === term[0] && boundedEditDistance(word, term, budget) <= budget) return 0.75;
  return 0;
}

let vocabulary: Array<{ word: string; stem: string }> | null = null;
const termMatchCache = new Map<string, Map<string, number>>();
const TERM_CACHE_LIMIT = 2000;

/**
 * Palavras do catálogo que casam com um termo (exato, radical ou erro de digitação).
 * Calculado UMA vez por termo sobre o vocabulário (~3 mil palavras), não por CNAE.
 */
function matchesForTerm(term: string) {
  const cached = termMatchCache.get(term);
  if (cached) return cached;
  if (!vocabulary) {
    const words = new Set<string>();
    for (const entry of ensureCnaeIndex()) {
      for (const word of entry.words) words.add(word);
      for (const word of entry.contextWords) words.add(word);
    }
    vocabulary = Array.from(words).map((word) => ({ word, stem: lightStem(word) }));
  }
  const termStem = lightStem(term);
  const matches = new Map<string, number>();
  for (const { word, stem } of vocabulary) {
    const strength = wordMatchesTerm(word, stem, term, termStem);
    if (strength > 0) matches.set(word, strength);
  }
  if (termMatchCache.size >= TERM_CACHE_LIMIT) termMatchCache.clear();
  termMatchCache.set(term, matches);
  return matches;
}

/** Quanto um termo da consulta casa com a descrição de um CNAE (0 = não casa). */
function scoreTermAgainstCnae(entry: IndexedCnae, matches: Map<string, number>) {
  if (matches.size === 0) return 0;
  let best = 0;
  for (const word of entry.words) {
    const strength = matches.get(word);
    if (strength) best = Math.max(best, strength * termWeight(word));
  }
  if (best > 0) return best;
  // Contexto (classe/grupo) vale menos que a descrição da subclasse.
  for (const word of entry.contextWords) {
    const strength = matches.get(word);
    if (strength) best = Math.max(best, strength * 0.35 * termWeight(word));
  }
  return best;
}

const ALIAS_KEYS = Object.keys(ACTIVITY_ALIASES);

/** Sinônimos do termo: exato, pelo radical ou com erro de digitação ("trasnportadora"). */
function resolveAliases(term: string): string[] {
  const direct = ACTIVITY_ALIASES[term] ?? ACTIVITY_ALIASES[lightStem(term)];
  if (direct) return direct;
  const budget = allowedTypos(term.length);
  if (budget === 0) return [];
  let best: { key: string; distance: number } | null = null;
  for (const key of ALIAS_KEYS) {
    if (key[0] !== term[0]) continue;
    const distance = boundedEditDistance(term, key, budget);
    if (distance <= budget && (!best || distance < best.distance)) best = { key, distance };
  }
  return best ? ACTIVITY_ALIASES[best.key] : [];
}

export function rankCnaesForTerms(terms: string[], limit = 5): CnaeCandidate[] {
  const index = ensureCnaeIndex();
  const cleanTerms = Array.from(new Set(terms.map((term) => foldSearchText(term)).filter((term) => term.length >= 3)));
  if (cleanTerms.length === 0) return [];

  const prepared = cleanTerms.map((term) => {
    const aliases = resolveAliases(term);
    return { term, direct: matchesForTerm(term), aliases: aliases.map((alias) => matchesForTerm(alias)) };
  });

  const ranked: CnaeCandidate[] = [];
  for (const entry of index) {
    let score = 0;
    let matchedPrimary = 0;
    const matchedTerms: string[] = [];
    for (const { term, direct, aliases } of prepared) {
      // Termo com sinônimo curado ("dentista" → "odontológica"): o sinônimo manda,
      // a semelhança literal ("dentária") pesa menos.
      let termScore = scoreTermAgainstCnae(entry, direct) * (aliases.length > 0 ? 0.6 : 1);
      for (const alias of aliases) termScore += scoreTermAgainstCnae(entry, alias);
      if (termScore > 0) {
        matchedPrimary += 1;
        matchedTerms.push(term);
        score += termScore;
      }
    }
    if (matchedPrimary === 0) continue;
    // Consulta com vários termos: CNAEs que cobrem todos os termos vêm antes.
    const coverage = matchedPrimary / cleanTerms.length;
    const finalScore = Math.round(score * coverage * coverage * 1000) / 1000;
    ranked.push({
      code: entry.code,
      formattedCode: entry.formattedCode,
      label: entry.label,
      classCode: entry.classCode,
      score: finalScore,
      matchedTerms
    });
  }

  ranked.sort((left, right) => right.score - left.score || left.code.localeCompare(right.code));
  return ranked.slice(0, Math.max(1, limit));
}

function lookupCnaeByCode(digits: string): CnaeCandidate[] {
  const index = ensureCnaeIndex();
  const exact = index.filter((entry) => entry.code === digits);
  const matches = exact.length > 0 ? exact : index.filter((entry) => entry.code.startsWith(digits) || entry.classCode === digits);
  return matches.slice(0, 10).map((entry) => ({
    code: entry.code,
    formattedCode: entry.formattedCode,
    label: entry.label,
    classCode: entry.classCode,
    score: entry.code === digits ? 100 : 50,
    matchedTerms: [digits]
  }));
}

type Span = { start: number; end: number; text: string };

function municipalitySpans(tokens: string[]): Span[] {
  const spans: Span[] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    if (PT_STOP_WORDS.has(tokens[start]) || QUERY_FILLER_WORDS.has(tokens[start])) continue;
    for (let end = start + 1; end <= Math.min(tokens.length, start + 5); end += 1) {
      if (PT_STOP_WORDS.has(tokens[end - 1]) && end - 1 !== start) {
        // Um nome de cidade não termina em preposição ("são josé dos").
        continue;
      }
      spans.push({ start, end, text: tokens.slice(start, end).join(" ") });
    }
  }
  return spans;
}

function isStrongActivityWord(token: string) {
  if (ACTIVITY_ALIASES[token]) return true;
  const best = rankCnaesForTerms([token], 1)[0];
  return Boolean(best && best.score >= 3);
}

type ScoredMunicipality = MunicipalityMatch & { span: Span; score: number; capital: boolean };

function findMunicipalityMatches(tokens: string[], stateCode: string | null): ScoredMunicipality[] {
  const buckets = ensureMunicipalityIndex();
  const results: ScoredMunicipality[] = [];
  const activityCache = new Map<string, boolean>();

  for (const span of municipalitySpans(tokens)) {
    const bucket = buckets.get(span.text[0]);
    if (!bucket) continue;
    const spanTokenCount = span.end - span.start;
    const compactLength = span.text.replace(/\s/g, "").length;
    let budget = Math.min(2, allowedTypos(compactLength));
    // Uma única palavra que também descreve atividade ("farmácia", "mercado") só vira cidade se for exata.
    if (spanTokenCount === 1) {
      const token = tokens[span.start];
      if (!activityCache.has(token)) activityCache.set(token, isStrongActivityWord(token));
      if (activityCache.get(token)) budget = 0;
    }
    for (const candidate of bucket) {
      if (Math.abs(candidate.tokenCount - spanTokenCount) > 1) continue;
      const distance = boundedEditDistance(span.text, candidate.folded, budget);
      if (distance > budget) continue;
      const exact = distance === 0;
      const confidence: "high" | "low" =
        exact || (spanTokenCount >= 2 && distance <= 1) || (compactLength >= 7 && distance <= 1) ? "high" : "low";
      const stateBonus = stateCode && candidate.stateCode === stateCode ? 30 : stateCode ? -40 : 0;
      results.push({
        name: candidate.name,
        stateCode: candidate.stateCode,
        ibge: candidate.ibge,
        matchedText: span.text,
        distance,
        confidence,
        span,
        capital: candidate.capital,
        score: compactLength * 3 - distance * 8 + (span.end === tokens.length ? 2 : 0) + stateBonus + (candidate.capital ? 1 : 0)
      });
    }
  }
  results.sort(
    (left, right) =>
      right.score - left.score ||
      left.distance - right.distance ||
      Number(right.capital) - Number(left.capital) ||
      left.name.localeCompare(right.name, "pt-BR") ||
      left.stateCode.localeCompare(right.stateCode)
  );
  return results;
}

function detectStateCode(tokens: string[]): { stateCode: string; index: number; length: number } | null {
  // Sigla só é aceita no fim ("... pato branco pr") para não confundir "se", "to", "pa" etc.
  const last = tokens.length - 1;
  if (last >= 1 && tokens[last].length === 2 && BRAZILIAN_UFS.has(tokens[last].toUpperCase())) {
    return { stateCode: tokens[last].toUpperCase(), index: last, length: 1 };
  }
  // Nome do estado por extenso no fim ("... em santa catarina").
  for (let length = 4; length >= 1; length -= 1) {
    const start = tokens.length - length;
    if (start < 1) continue;
    const text = tokens.slice(start).join(" ");
    const uf = normalizeUf(text);
    if (uf && text.length > 2) return { stateCode: uf, index: start, length };
  }
  return null;
}

/** Interpreta uma consulta livre. Puro e síncrono (roda no servidor, sem rede). */
export function interpretQuery(input: string): QueryInterpretation {
  const query = (input ?? "").slice(0, 200);
  const normalized = foldSearchText(query);
  const empty: QueryInterpretation = {
    query,
    normalized,
    cnpj: null,
    stateCode: null,
    stateSource: null,
    municipality: null,
    municipalityAlternatives: [],
    cnaes: [],
    activityTerms: [],
    residualText: normalized
  };
  if (!normalized) return empty;

  // Código CNAE digitado ("4930-2/02", "4930202", "49302") tem precedência sobre prefixo de CNPJ.
  const cnaeDigits = normalizeCnaeCode(query);
  const formattedCnae = /^\s*\d{4}-\d(?:\/\d{2})?\s*$/.test(query);
  const bareCnae = /^\s*\d{7}\s*$/.test(query) && ensureCnaeIndex().some((entry) => entry.code === cnaeDigits);
  if (formattedCnae || bareCnae) {
    return { ...empty, cnaes: lookupCnaeByCode(cnaeDigits), residualText: "" };
  }

  const cnpj = detectCnpjQuery(query);
  if (cnpj) return { ...empty, cnpj, residualText: "" };

  let tokens = normalized.split(" ");
  const consumed = new Set<number>();

  const state = detectStateCode(tokens);
  let stateCode: string | null = null;
  let stateSource: QueryInterpretation["stateSource"] = null;
  let stateNamedCity: MunicipalityMatch | null = null;
  if (state) {
    stateCode = state.stateCode;
    stateSource = state.length === 1 && tokens[state.index].length === 2 ? "sigla" : "nome";
    for (let index = state.index; index < state.index + state.length; index += 1) consumed.add(index);
    // "restaurante são paulo": o nome do estado é também o da capital → a cidade é mais específica.
    const stateText = tokens.slice(state.index, state.index + state.length).join(" ");
    const sameNameCity = state.length > 0 && stateText.length > 2
      ? (ensureMunicipalityIndex().get(stateText[0]) ?? []).find((item) => item.folded === stateText && item.stateCode === state.stateCode)
      : undefined;
    if (sameNameCity) {
      stateNamedCity = {
        name: sameNameCity.name,
        stateCode: sameNameCity.stateCode,
        ibge: sameNameCity.ibge,
        matchedText: stateText,
        distance: 0,
        confidence: "high"
      };
    }
  }

  // A UF (quando reconhecida) está sempre no fim: a cidade é procurada antes dela.
  const matches = findMunicipalityMatches(tokens.slice(0, state?.index ?? tokens.length), stateCode);

  let municipality: MunicipalityMatch | null = stateNamedCity;
  let alternatives: MunicipalityMatch[] = [];
  if (!municipality && matches.length > 0) {
    const best = matches[0];
    const sameSpan = matches.filter(
      (item) => item.span.start === best.span.start && item.span.end === best.span.end && item.distance === best.distance
    );
    const strip = ({ name, stateCode: uf, ibge, matchedText, distance, confidence }: ScoredMunicipality): MunicipalityMatch => ({
      name,
      stateCode: uf,
      ibge,
      matchedText,
      distance,
      confidence
    });
    // Nome ambíguo sem UF (ex.: "Bom Jesus"): não escolhe sozinho; vira sugestão.
    const ambiguous = !stateCode && new Set(sameSpan.map((item) => item.stateCode)).size > 1;
    municipality = strip(best);
    if (ambiguous) municipality = { ...municipality, confidence: "low" };
    alternatives = sameSpan.slice(1, 6).map(strip);
    if (municipality.confidence === "high") {
      for (let index = best.span.start; index < best.span.end; index += 1) consumed.add(index);
      if (!stateCode) {
        stateCode = municipality.stateCode;
        stateSource = "cidade";
      }
    }
  }

  tokens = tokens.filter((_, index) => !consumed.has(index));
  // Preposições que ligavam atividade e cidade ("... em pato branco") já não têm função.
  const residualTokens = tokens.filter((token) => !QUERY_FILLER_WORDS.has(token));
  const activityTerms = residualTokens.filter((token) => token.length >= 3 && !PT_STOP_WORDS.has(token));
  const cnaes = rankCnaesForTerms(activityTerms, 5).filter((candidate) => candidate.score > 0);

  return {
    query,
    normalized,
    cnpj: null,
    stateCode,
    stateSource,
    municipality,
    municipalityAlternatives: alternatives,
    cnaes,
    activityTerms,
    residualText: residualTokens.filter((token) => !PT_STOP_WORDS.has(token) || residualTokens.length === 1).join(" ")
  };
}

/** Agrupa os melhores CNAEs quando empatam na mesma classe (ex.: 4930-2/01 e 4930-2/02). */
export function primaryCnaeGroup(cnaes: CnaeCandidate[]): CnaeCandidate[] {
  if (cnaes.length === 0) return [];
  const top = cnaes[0];
  return cnaes.filter((candidate) => candidate.classCode === top.classCode && candidate.score >= top.score * 0.85).slice(0, 4);
}
