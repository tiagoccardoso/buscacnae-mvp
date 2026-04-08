import rawCatalog from "@/data/cnae-catalog.json";
import { formatCnaeCode, normalizeCnaeCode } from "@/lib/cnae-utils";

export type CnaeOption = {
  value: string;
  label: string;
};

type RawCatalogEntry = {
  code: string;
  description: string;
  classCode: string;
  classDescription: string;
  groupCode: string;
  groupDescription: string;
  divisionCode: string;
  divisionDescription: string;
  sectionCode: string;
  sectionDescription: string;
  source: "official-subclass" | "official-terminal-class";
};

type IndexedCnaeOption = CnaeOption & {
  description: string;
  classCodeDigits: string;
  groupCodeDigits: string;
  divisionCodeDigits: string;
  sectionCode: string;
  normalizedDescription: string;
  normalizedLabel: string;
  normalizedSearchText: string;
};

const PORTUGUESE_LOCALE = "pt-BR";
const EMPTY_OPTIONS: CnaeOption[] = [];

const STOP_WORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "ou",
  "para",
  "por",
  "sem",
  "um",
  "uma"
]);

const TERM_ALIASES: Record<string, string[]> = {
  industria: ["industrial", "industrias", "fabrica", "fabricacao", "fabril", "manufatura", "producao"],
  industrial: ["industria", "fabrica", "fabricacao", "fabril", "manufatura", "producao"],
  fabricacao: ["fabrica", "industrial", "industria", "manufatura", "producao"],
  fabrica: ["fabricacao", "industrial", "industria", "manufatura", "producao"],
  comercio: ["comercial", "lojista", "loja", "varejo", "varejista", "venda", "vendas"],
  varejo: ["comercio", "loja", "lojista", "venda", "vendas", "varejista"],
  atacado: ["atacadista", "comercio"],
  atacadista: ["atacado", "comercio"],
  ti: ["informatica", "software", "sistema", "sistemas", "tecnologia", "tecnologia da informacao"],
  tecnologia: ["informatica", "software", "sistema", "sistemas", "ti"],
  informatica: ["software", "sistema", "sistemas", "tecnologia", "ti"],
  saude: ["ambulatorio", "clinica", "clinicas", "hospital", "hospitalar", "medico", "medica", "medicas", "medicos"],
  educacao: ["curso", "cursos", "ensino", "escola", "escolar", "treinamento"],
  alimentacao: ["bar", "comida", "lanchonete", "refeicao", "refeicoes", "restaurante"],
  transporte: ["armazenagem", "entrega", "frete", "logistica"],
  construcao: ["construtora", "obra", "obras"],
  juridico: ["advocacia", "advogado", "advogados"],
  contabil: ["auditoria", "contabilidade", "contador", "tributario"]
};

const SECTION_ALIASES: Record<string, string[]> = {
  A: ["agro", "agricola", "agricultura", "aquicultura", "pecuaria", "pesca", "rural"],
  B: ["extracao", "industria", "industrial", "mineracao"],
  C: ["fabrica", "fabricacao", "industria", "industrial", "manufatura", "producao"],
  D: ["energia", "gas", "industria", "industrial", "utilidade publica"],
  E: ["agua", "esgoto", "gestao de residuos", "limpeza urbana", "residuos", "saneamento"],
  F: ["construcao", "construtora", "obra", "obras", "reforma"],
  G: ["comercio", "comercial", "loja", "lojista", "revenda", "varejo", "venda", "vendas"],
  H: ["armazenagem", "correio", "frete", "logistica", "transporte"],
  I: ["alimentacao", "bar", "hotel", "hospedagem", "lanchonete", "pousada", "restaurante"],
  J: ["aplicativo", "app", "informatica", "internet", "site", "software", "tecnologia", "ti", "web"],
  K: ["banco", "credito", "financeira", "financeiro", "seguros"],
  L: ["aluguel", "imobiliaria", "imobiliario", "locacao"],
  M: ["consultoria", "escritorio", "profissional", "tecnica"],
  N: ["administrativo", "apoio", "limpeza", "portaria", "seguranca terceirizada", "terceirizacao"],
  O: ["administracao publica", "defesa", "governo", "seguridade social"],
  P: ["curso", "educacao", "ensino", "escola", "treinamento"],
  Q: ["clinica", "hospital", "medico", "saude", "social"],
  R: ["arte", "cultura", "esporte", "evento", "lazer", "recreacao"],
  S: ["beleza", "pessoal", "religioso", "servicos pessoais"],
  T: ["domestico", "residencial", "servicos domesticos"],
  U: ["consulado", "diplomatico", "embaixada", "instituicao extraterritorial", "organismo internacional"]
};

function sentenceCaseSegment(segment: string) {
  const trimmed = segment.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLocaleLowerCase(PORTUGUESE_LOCALE);
  return lower.replace(
    /(^|[\s([{-]+)([a-zà-ÿ])/gu,
    (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase(PORTUGUESE_LOCALE)}`
  );
}

function formatCnaeDescription(value: string) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";

  const shouldNormalize = cleaned === cleaned.toUpperCase();
  if (!shouldNormalize) return cleaned;

  return cleaned
    .split(/([:;]\s+)/)
    .map((segment, index) => (index % 2 === 0 ? sentenceCaseSegment(segment) : segment))
    .join("");
}

function normalizeText(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9/ -]+/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const unique = new Set<string>();

  for (const value of values) {
    const cleaned = String(value ?? "").trim();
    if (!cleaned) continue;
    unique.add(cleaned);
  }

  return Array.from(unique);
}

function tokenize(value: string) {
  return uniqueStrings(
    normalizeText(value)
      .split(/[\s/-]+/)
      .map((token) => token.trim())
      .filter((token) => token && !STOP_WORDS.has(token))
  );
}

function expandTokens(tokens: string[]) {
  const expanded = new Set<string>(tokens);

  for (const token of tokens) {
    const aliases = TERM_ALIASES[token] ?? [];
    for (const alias of aliases) {
      const normalized = normalizeText(alias);
      if (normalized) expanded.add(normalized);
    }

    if (token.endsWith("s") && token.length > 4) {
      expanded.add(token.slice(0, -1));
    } else if (!token.endsWith("s") && token.length > 4) {
      expanded.add(`${token}s`);
    }
  }

  return Array.from(expanded);
}

function buildSearchText(entry: RawCatalogEntry, description: string) {
  return uniqueStrings([
    description,
    entry.classDescription,
    entry.groupDescription,
    entry.divisionDescription,
    entry.sectionDescription,
    entry.code,
    entry.classCode,
    entry.groupCode,
    entry.divisionCode,
    entry.sectionCode,
    ...(SECTION_ALIASES[entry.sectionCode] ?? []),
    entry.source === "official-terminal-class" ? "atividade final classe terminal" : "subclasse oficial"
  ]).join(" | ");
}

const CATALOG = (rawCatalog as RawCatalogEntry[])
  .map((entry) => {
    const value = normalizeCnaeCode(entry.code);
    const description = formatCnaeDescription(entry.description);
    const label = description ? `${formatCnaeCode(value)} · ${description}` : formatCnaeCode(value);
    const searchText = buildSearchText(entry, description);

    return {
      value,
      label,
      description,
      classCodeDigits: normalizeCnaeCode(entry.classCode),
      groupCodeDigits: normalizeCnaeCode(entry.groupCode),
      divisionCodeDigits: normalizeCnaeCode(entry.divisionCode),
      sectionCode: entry.sectionCode,
      normalizedDescription: normalizeText(description),
      normalizedLabel: normalizeText(label),
      normalizedSearchText: normalizeText(searchText)
    } satisfies IndexedCnaeOption;
  })
  .sort((left, right) => left.label.localeCompare(right.label, PORTUGUESE_LOCALE));

const OPTIONS = CATALOG.map<CnaeOption>(({ value, label }) => ({ value, label }));
const OPTION_BY_VALUE = new Map(CATALOG.map((item) => [item.value, item]));

function resolveOptionById(id: string) {
  const normalized = normalizeCnaeCode(id);
  if (!normalized) return null;

  const directMatch = OPTION_BY_VALUE.get(normalized);
  if (directMatch) return directMatch;

  if (normalized.length === 5) {
    const terminalMatch = OPTION_BY_VALUE.get(`${normalized}00`);
    if (terminalMatch) return terminalMatch;
  }

  const prefixedMatches = CATALOG.filter((item) => item.value.startsWith(normalized) || item.classCodeDigits === normalized);
  if (prefixedMatches.length === 1) return prefixedMatches[0];

  return null;
}

function scoreItem(item: IndexedCnaeOption, query: string, codeQuery: string, tokens: string[], expandedTokens: string[]) {
  let score = 0;

  if (codeQuery) {
    if (item.value === codeQuery) score += 1_000_000;
    else if (item.value.startsWith(codeQuery)) score += 800_000 - Math.max(0, item.value.length - codeQuery.length);
    else if (item.classCodeDigits === codeQuery) score += 700_000;
    else if (item.classCodeDigits.startsWith(codeQuery)) score += 650_000;
    else if (item.groupCodeDigits.startsWith(codeQuery)) score += 500_000;
    else if (item.divisionCodeDigits.startsWith(codeQuery)) score += 350_000;
  }

  if (query) {
    if (item.normalizedDescription === query) score += 120_000;
    if (item.normalizedLabel === query) score += 100_000;
    if (item.normalizedDescription.startsWith(query)) score += 70_000;
    if (item.normalizedLabel.startsWith(query)) score += 60_000;
    if (item.normalizedDescription.includes(query)) score += 45_000;
    if (item.normalizedSearchText.includes(query)) score += 18_000;
  }

  for (const token of tokens) {
    if (item.normalizedDescription.includes(token)) score += 2_500;
    else if (item.normalizedSearchText.includes(token)) score += 900;
    else return Number.NEGATIVE_INFINITY;
  }

  for (const token of expandedTokens) {
    if (tokens.includes(token)) continue;
    if (item.normalizedDescription.includes(token)) score += 1_100;
    else if (item.normalizedSearchText.includes(token)) score += 350;
  }

  if (item.sectionCode === "B" || item.sectionCode === "C" || item.sectionCode === "D") {
    if (tokens.includes("industria") || expandedTokens.includes("industria")) score += 600;
  }

  const wantsTechnology = ["app", "aplicativo", "informatica", "internet", "site", "software", "sistema", "sistemas", "tecnologia", "tecnologia da informacao", "ti", "web"].some(
    (token) => tokens.includes(token) || expandedTokens.includes(token)
  );

  if (wantsTechnology) {
    if (item.sectionCode === "J") score += 6_000;
    if (item.normalizedDescription.includes("tecnologia da informacao")) score += 8_000;
    if (item.normalizedDescription.includes("software") || item.normalizedDescription.includes("sistema")) score += 4_000;
  }

  return score;
}

export async function getAllCnaeOptions() {
  return OPTIONS;
}

export async function searchCnaeOptions(params: {
  query?: string;
  ids?: string[];
  limit?: number;
}) {
  const ids = Array.from(new Set((params.ids ?? []).map((item) => normalizeCnaeCode(item)).filter(Boolean)));

  if (ids.length > 0) {
    return ids
      .map((id) => {
        const item = resolveOptionById(id);
        return item ? { value: item.value, label: item.label } : { value: id, label: formatCnaeCode(id) };
      })
      .filter(Boolean);
  }

  const query = normalizeText(params.query ?? "");
  const codeQuery = normalizeCnaeCode(params.query ?? "");
  const tokens = tokenize(params.query ?? "");
  const expandedTokens = expandTokens(tokens);
  const limit = Number.isFinite(params.limit) ? Math.min(Math.max(Number(params.limit), 1), 200) : 25;

  if (!query && !codeQuery) {
    return OPTIONS.slice(0, limit);
  }

  const ranked = CATALOG.map((item) => ({
    item,
    score: scoreItem(item, query, codeQuery, tokens, expandedTokens)
  }))
    .filter(({ score }) => Number.isFinite(score) && score > 0)
    .sort((left, right) => right.score - left.score || left.item.label.localeCompare(right.item.label, PORTUGUESE_LOCALE))
    .slice(0, limit)
    .map(({ item }) => ({ value: item.value, label: item.label }));

  if (ranked.length > 0) {
    return ranked;
  }

  if (codeQuery) {
    const fallback = CATALOG.filter((item) => item.value.includes(codeQuery) || item.classCodeDigits.includes(codeQuery))
      .slice(0, limit)
      .map(({ value, label }) => ({ value, label }));

    if (fallback.length > 0) return fallback;
  }

  return EMPTY_OPTIONS;
}
