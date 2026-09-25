/**
 * Verificação de números da INTERPRETAÇÃO DA IA.
 *
 * A interpretação é o único texto escrito pelo modelo. Ela só é exibida se TODOS os
 * números que contém existirem nos fatos calculados pelo motor (mesmo valor, em qualquer
 * formatação pt-BR/en). Um número inventado, arredondado de outro jeito ou somado pelo
 * modelo derruba a interpretação inteira — a resposta segue só com dado + cálculo.
 */

const NUMBER_TOKEN = /(?<![\p{L}\d])(?:R\$\s*)?\d{1,3}(?:[.\s\u00a0]\d{3})+(?:,\d+)?%?|(?<![\p{L}\d])(?:R\$\s*)?\d+(?:[.,]\d+)?%?/gu;

/** Converte "1.234,5", "1,234.5", "12,5%", "R$ 10.000" → número (ou null). */
export function parseNumberToken(token: string): number | null {
  let text = token.replace(/R\$\s*/g, "").replace(/%$/, "").replace(/[\s\u00a0]/g, "");
  if (!text) return null;
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (hasComma) {
    const [, decimals] = text.split(",");
    text = decimals && decimals.length === 3 && !/^0/.test(text) ? text.replace(",", "") : text.replace(",", ".");
  } else if (hasDot) {
    const parts = text.split(".");
    if (parts.length > 2 || (parts[1]?.length === 3 && parts[0] !== "0")) text = text.replace(/\./g, "");
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function extractNumbers(text: string) {
  return Array.from(text.matchAll(NUMBER_TOKEN), (match) => match[0]);
}

function collect(value: unknown, into: Set<number>, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) into.add(value);
    return;
  }
  if (typeof value === "string") {
    for (const token of extractNumbers(value)) {
      const parsed = parseNumberToken(token);
      if (parsed !== null) into.add(parsed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, depth + 1);
    return;
  }
  if (typeof value === "object") for (const item of Object.values(value as Record<string, unknown>)) collect(item, into, depth + 1);
}

/** Números permitidos: SÓ o que aparece nos fatos (nem contagens pequenas "de cabeça"). */
export function allowedNumbers(facts: unknown) {
  const allowed = new Set<number>();
  collect(facts, allowed);
  return allowed;
}

export type NumberCheck = { ok: true } | { ok: false; unknown: string[] };

export function checkNumbers(text: string, facts: unknown): NumberCheck {
  const allowed = allowedNumbers(facts);
  const unknown: string[] = [];
  for (const token of extractNumbers(text)) {
    const value = parseNumberToken(token);
    if (value === null) continue;
    const matches = Array.from(allowed).some((candidate) => Math.abs(candidate - value) < 1e-9);
    if (!matches) unknown.push(token);
  }
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown };
}

/** Limpa a interpretação: texto puro, sem links/markup, no máximo ~600 caracteres. */
export function sanitizeInterpretation(text: string) {
  const clean = text
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= 600) return clean;
  const cut = clean.slice(0, 600);
  const lastStop = cut.lastIndexOf(".");
  return lastStop > 200 ? cut.slice(0, lastStop + 1) : `${cut}…`;
}
