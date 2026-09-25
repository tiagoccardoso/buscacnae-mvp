/**
 * Duplicidade por colisão de chave — mesmo conceito dos "keyers" de clustering do
 * OpenRefine (FingerprintKeyer / NGramFingerprintKeyer), reimplementado em TS.
 */

const NON_DIACRITICS: Record<string, string> = { ß: "ss", æ: "ae", ø: "oe", œ: "oe", ð: "d", đ: "d", þ: "th", ł: "l", ı: "i" };
// Pontuação e controles (espaço é mantido para a separação de tokens).
const PUNCT_CTRL = /[\p{P}\p{S}\u0000-\u0008\u000E-\u001F\u007F-\u009F]/gu;

function fold(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯʰ-˿]/g, "")
    .replace(/[ßæøœðđþłı]/g, (char) => NON_DIACRITICS[char] ?? char);
}

/**
 * Fingerprint: minúsculas, sem acento/pontuação, tokens únicos e ordenados.
 * "Padaria  São-João Ltda." e "LTDA PADARIA SAO JOAO" → "joao ltda padaria sao".
 */
export function fingerprint(value: string | null | undefined): string {
  if (!value) return "";
  const tokens = fold(value).replace(PUNCT_CTRL, " ").split(/\s+/).filter(Boolean);
  return Array.from(new Set(tokens)).sort().join(" ");
}

/** N-gram fingerprint: tolera espaços e pequenas variações ("PadariaSaoJoao" ≈ "Padaria Sao Joao"). */
export function ngramFingerprint(value: string | null | undefined, size = 2): string {
  if (!value) return "";
  const compact = fold(value).replace(PUNCT_CTRL, "").replace(/\s+/g, "");
  if (compact.length <= size) return compact;
  const grams = new Set<string>();
  for (let index = 0; index <= compact.length - size; index += 1) grams.add(compact.slice(index, index + size));
  return Array.from(grams).sort().join("");
}

// Sufixos societários/porte que não distinguem empresas (S/A, ME, EPP, EIRELI...).
const LEGAL_SUFFIX_TOKENS = new Set(["ltda", "limitada", "me", "epp", "eireli", "sa", "s", "a", "ss", "mei", "cia", "companhia", "slu", "ei"]);

/**
 * Chave de razão social para detectar a mesma empresa escrita de formas diferentes.
 * Remove sufixos societários ("LTDA", "S/A", "ME"…) antes do fingerprint.
 */
export function companyNameKey(value: string | null | undefined): string {
  const key = fingerprint(value)
    .split(" ")
    .filter((token) => token && !LEGAL_SUFFIX_TOKENS.has(token))
    .join(" ");
  return key || fingerprint(value);
}

export type DuplicateCluster<T> = { key: string; items: T[] };

/** Agrupa itens cuja chave colide (clusters com 2+ itens), ordenados pelo tamanho. */
export function findDuplicateClusters<T>(items: readonly T[], keyOf: (item: T) => string | null | undefined): DuplicateCluster<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups, ([key, bucket]) => ({ key, items: bucket }))
    .filter((cluster) => cluster.items.length > 1)
    .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
}

/**
 * Remove duplicados preservando a ordem da primeira ocorrência. Quando `merge` é
 * informado, as ocorrências seguintes são combinadas à primeira (ex.: completar campos).
 */
export function dedupeByKey<T>(items: readonly T[], keyOf: (item: T) => string | null | undefined, merge?: (kept: T, duplicate: T) => T): T[] {
  const byKey = new Map<string, number>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key) {
      result.push(item);
      continue;
    }
    const index = byKey.get(key);
    if (index === undefined) {
      byKey.set(key, result.length);
      result.push(item);
    } else if (merge) {
      result[index] = merge(result[index], item);
    }
  }
  return result;
}

/** Quantidade de campos preenchidos — critério para escolher o registro "mais completo". */
export function countFilledFields(record: Record<string, unknown>, fields: readonly string[]): number {
  let count = 0;
  for (const field of fields) {
    const value = record[field];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    count += 1;
  }
  return count;
}
