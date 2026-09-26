import { foldText } from "@/lib/data-quality/normalize";

/**
 * Utilitários de texto da Busca Avançada (Fase 7).
 *
 * Tudo aqui é determinístico e sem dependência externa: é usado tanto para montar
 * documentos do índice quanto pelo intérprete local de consultas, que continua
 * funcionando quando o mecanismo de busca está fora do ar.
 */

/** Palavras que não identificam empresa, cidade nem atividade. */
export const PT_STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos",
  "o", "os", "ou", "para", "pela", "pelas", "pelo", "pelos", "por", "sem", "um", "uma", "que"
]);

/** Termos genéricos de consulta ("empresas de transporte em Pato Branco"). */
export const QUERY_FILLER_WORDS: ReadonlySet<string> = new Set([
  "empresa", "empresas", "cnpj", "cnpjs", "lista", "listas", "buscar", "busca", "procurar", "encontrar", "todas", "todos",
  "cidade", "municipio", "estado", "regiao", "perto", "proximo", "proximas", "proximos", "ativas", "ativa"
]);

/** Sufixos societários: não diferenciam empresas e poluem a relevância. */
export const LEGAL_SUFFIX_WORDS: ReadonlySet<string> = new Set([
  "ltda", "me", "epp", "eireli", "sa", "s/a", "slu", "ss", "mei", "cia"
]);

const NON_ALNUM = /[^a-z0-9]+/g;

/** Chave de comparação: sem acento, minúsculas, pontuação vira espaço, espaços colapsados. */
export function foldSearchText(value: string | null | undefined): string {
  if (!value) return "";
  return foldText(value).replace(NON_ALNUM, " ").replace(/\s+/g, " ").trim();
}

export function tokenizeSearchText(value: string | null | undefined): string[] {
  const folded = foldSearchText(value);
  return folded ? folded.split(" ") : [];
}

/**
 * Remove sequências que parecem CPF (11 dígitos, com ou sem máscara) de nomes.
 *
 * A razão social de MEI costuma ser "NOME DA PESSOA 12345678901". O CPF é dado
 * pessoal (LGPD) e não tem utilidade de busca: nunca vai para o índice.
 */
export function stripPersonalIdentifiers(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const cleaned = value
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

/** Extrai um CNPJ (completo ou raiz) digitado com ou sem máscara. Aceita CNPJ alfanumérico. */
export function detectCnpjQuery(value: string): { kind: "full" | "root" | "prefix"; value: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Só trata como CNPJ se a consulta for essencialmente um identificador (sem palavras).
  if (!/^[\dA-Za-z.\-/\s]+$/.test(trimmed)) return null;
  const compact = trimmed.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (!/\d/.test(compact)) return null;
  if (/^[A-Z0-9]{12}\d{2}$/.test(compact) && /\d{2}$/.test(compact) && /\d{4,}/.test(compact)) {
    return { kind: "full", value: compact };
  }
  if (/^\d{8}$/.test(compact)) return { kind: "root", value: compact };
  if (/^\d{5,13}$/.test(compact)) return { kind: "prefix", value: compact };
  return null;
}

/**
 * Radical leve para português (sem dicionário): suficiente para aproximar
 * "transportadoras" → "transport", "padarias" → "padari", "construtora" → "constru".
 * Não é um stemmer completo — só alimenta a comparação por prefixo do intérprete local.
 */
const STEM_SUFFIXES = [
  "adoras", "adores", "adora", "ador", "doras", "dores", "dora", "dor",
  "icoes", "acoes", "icao", "acao", "coes", "cao", "mentos", "mento",
  "istas", "ista", "arias", "aria", "orias", "oria", "eiras", "eiros", "eira", "eiro",
  "oras", "ora", "ores", "or", "icas", "icos", "ica", "ico",
  "ias", "ia", "es", "as", "os", "s", "a", "o", "e"
];

export function lightStem(token: string): string {
  const folded = foldSearchText(token).replace(/\s/g, "");
  if (folded.length <= 4) return folded;
  for (const suffix of STEM_SUFFIXES) {
    if (folded.endsWith(suffix) && folded.length - suffix.length >= 4) {
      return folded.slice(0, folded.length - suffix.length);
    }
  }
  return folded;
}

/**
 * Distância de Damerau-Levenshtein (transposição adjacente = 1) com teto.
 * Retorna `max + 1` assim que a distância ultrapassa o teto (poda barata).
 */
export function boundedEditDistance(left: string, right: string, max: number): number {
  if (left === right) return 0;
  const leftLength = left.length;
  const rightLength = right.length;
  if (Math.abs(leftLength - rightLength) > max) return max + 1;
  if (leftLength === 0) return rightLength;
  if (rightLength === 0) return leftLength;

  let previousPrevious = new Array<number>(rightLength + 1).fill(0);
  let previous = new Array<number>(rightLength + 1);
  let current = new Array<number>(rightLength + 1);
  for (let column = 0; column <= rightLength; column += 1) previous[column] = column;

  for (let row = 1; row <= leftLength; row += 1) {
    current[0] = row;
    let rowMinimum = current[0];
    for (let column = 1; column <= rightLength; column += 1) {
      const cost = left.charCodeAt(row - 1) === right.charCodeAt(column - 1) ? 0 : 1;
      let value = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      if (
        row > 1 &&
        column > 1 &&
        left.charCodeAt(row - 1) === right.charCodeAt(column - 2) &&
        left.charCodeAt(row - 2) === right.charCodeAt(column - 1)
      ) {
        value = Math.min(value, previousPrevious[column - 2] + 1);
      }
      current[column] = value;
      if (value < rowMinimum) rowMinimum = value;
    }
    if (rowMinimum > max) return max + 1;
    const recycled = previousPrevious;
    previousPrevious = previous;
    previous = current;
    current = recycled;
  }
  return previous[rightLength];
}

/** Tolerância a erro por tamanho da palavra (mesma ideia do Meilisearch: 1 erro a partir de 4, 2 a partir de 8). */
export function allowedTypos(length: number): number {
  if (length >= 8) return 2;
  if (length >= 4) return 1;
  return 0;
}
