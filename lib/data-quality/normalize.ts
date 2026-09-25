/**
 * Qualidade de dados do BuscaCNAE — regras centralizadas.
 *
 * Inspirado nos conceitos do OpenRefine (BSD-3, referência local em ../OpenRefine),
 * sem incorporar código dele:
 * - "common transforms": trim, colapso de espaços, remoção de caracteres de controle,
 *   normalização Unicode (NFC) e "blank-out" de valores sentinela ("-", "N/A", "0000"…);
 * - transformações tipadas por coluna (CNPJ, telefone, CEP, UF, município, CNAE…);
 * - clustering por colisão de chave (FingerprintKeyer / NGramFingerprintKeyer) para
 *   detectar duplicidades sem depender de igualdade exata (ver ./dedupe.ts).
 *
 * Princípios:
 * - nada é inventado: valor irreconhecível vira null, nunca um "palpite";
 * - identificadores inválidos pelo dígito verificador NÃO são descartados (a fonte é
 *   oficial); são sinalizados via `assessEstablishmentQuality`;
 * - módulo puro (sem Node/DB/rede): pode ser usado no servidor e no navegador.
 */

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

// C0/C1 (exceto \t \n \r, tratados como espaço), zero-width e BOM.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const UNICODE_SPACES = /[\s   -   　]+/g;
const DIACRITICS = /[̀-ͯ]/g;

/** Valores que as bases públicas usam para "não informado". Comparação sem acento/caixa. */
const PLACEHOLDERS = new Set([
  "-",
  "--",
  "---",
  ".",
  "..",
  "...",
  "_",
  "?",
  "null",
  "nil",
  "none",
  "undefined",
  "nan",
  "n/a",
  "n/d",
  "na",
  "nd",
  "nao informado",
  "nao informada",
  "nao consta",
  "sem informacao",
  "sem dados",
  "vazio",
  "inexistente"
]);

/** Remove acentos e baixa a caixa (chave de comparação, nunca para exibição). */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(DIACRITICS, "").toLowerCase();
}

function isPlaceholder(text: string) {
  if (/^\*+$/.test(text)) return true; // dados mascarados pela fonte ("********")
  return PLACEHOLDERS.has(foldText(text));
}

/**
 * Limpeza base aplicada a qualquer texto vindo da fonte:
 * NFC, remove controles/zero-width, converte espaços Unicode, colapsa e apara.
 * Retorna null para vazio ou sentinela de "não informado".
 */
export function cleanString(value: unknown): string | null {
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else return null;

  text = text
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .replace(/[\t\n\r]/g, " ")
    .replace(CONTROL_CHARS, "")
    .replace(UNICODE_SPACES, " ")
    .trim();

  if (!text || isPlaceholder(text)) return null;
  return text;
}

const LOWERCASE_PARTICLES = new Set(["de", "da", "das", "do", "dos", "e", "d", "del", "di"]);

/**
 * Title case pt-BR para nomes próprios (município, bairro):
 * "SANTA BARBARA D'OESTE" → "Santa Barbara d'Oeste"; "RIO DE JANEIRO" → "Rio de Janeiro".
 */
export function toPtBrTitleCase(value: string): string {
  return value
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      const apostrophe = word.match(/^(d|dall|l)['’](.+)$/);
      if (apostrophe) {
        const rest = apostrophe[2];
        return `${index === 0 ? apostrophe[1].toUpperCase() : apostrophe[1]}'${rest.charAt(0).toLocaleUpperCase("pt-BR")}${rest.slice(1)}`;
      }
      if (index > 0 && LOWERCASE_PARTICLES.has(word)) return word;
      return word
        .split("-")
        .map((part) => (part ? part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1) : part))
        .join("-");
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// CNPJ (numérico e alfanumérico — IN RFB 2.229/2024)
// ---------------------------------------------------------------------------

/**
 * Normaliza CNPJ: remove máscara, maiúsculas e, para valores só numéricos com
 * 12–13 dígitos (zeros à esquerda perdidos em planilhas/números), completa com zeros.
 * Retorna null quando não há 14 posições válidas.
 */
export function normalizeCnpjValue(value: unknown): string | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : cleanString(value);
  if (!text) return null;
  let cnpj = text.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (/^\d{12,13}$/.test(cnpj)) cnpj = cnpj.padStart(14, "0");
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) return null;
  return cnpj;
}

function cnpjCheckDigit(base: string, weights: number[]) {
  let sum = 0;
  for (let index = 0; index < weights.length; index += 1) {
    sum += (base.charCodeAt(index) - 48) * weights[index];
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Valida dígitos verificadores (inclui o CNPJ alfanumérico: valor = código ASCII − 48). */
export function isValidCnpj(value: unknown): boolean {
  const cnpj = normalizeCnpjValue(value);
  if (!cnpj) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const first = cnpjCheckDigit(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = cnpjCheckDigit(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.charAt(12) === String(first) && cnpj.charAt(13) === String(second);
}

// ---------------------------------------------------------------------------
// Telefone (Brasil)
// ---------------------------------------------------------------------------

const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51,
  53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94,
  95, 96, 97, 98, 99
]);

export type NormalizedPhone = {
  /** Somente dígitos, com DDD (10 fixo / 11 celular) ou 0800/0300/0500/0900 (11 dígitos). */
  digits: string;
  ddd: string | null;
  isMobile: boolean;
  /** "(11) 98765-4321", "(11) 3333-4444" ou "0800 123 4567". */
  formatted: string;
};

function formatPhoneDigits(digits: string) {
  if (/^0[3589]00/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  const split = number.length - 4;
  return `(${ddd}) ${number.slice(0, split)}-${number.slice(split)}`;
}

/**
 * Normaliza telefone brasileiro: remove +55, zero de longa distância e código de
 * operadora; exige DDD válido e 8/9 dígitos (celular começa com 9). Sem DDD → null
 * (não é possível discar com segurança). Números com todos os dígitos iguais → null.
 */
export function normalizePhone(value: unknown): NormalizedPhone | null {
  const text = cleanString(value);
  if (!text) return null;
  let digits = text.replace(/\D/g, "");
  if (!digits) return null;

  if (/^0[3589]00\d{7}$/.test(digits)) {
    return { digits, ddd: null, isMobile: false, formatted: formatPhoneDigits(digits) };
  }

  digits = digits.replace(/^0+/, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
  // Código de operadora (ex.: 0 21 11 98765-4321) após remover o zero inicial.
  if ((digits.length === 12 || digits.length === 13) && VALID_DDDS.has(Number(digits.slice(2, 4)))) digits = digits.slice(2);

  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (!VALID_DDDS.has(ddd)) return null;
  const subscriber = digits.slice(2);
  if (/^(\d)\1+$/.test(subscriber)) return null;
  if (subscriber.length === 9 && subscriber.charAt(0) !== "9") return null;
  if (subscriber.length === 8 && !/^[2-9]/.test(subscriber)) return null;

  return {
    digits,
    ddd: digits.slice(0, 2),
    isMobile: subscriber.length === 9,
    formatted: formatPhoneDigits(digits)
  };
}

// ---------------------------------------------------------------------------
// E-mail / site
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Primeiro e-mail válido (aceita listas separadas por ; , ou espaço), em minúsculas. */
export function normalizeEmail(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  for (const candidate of text.split(/[;,\s]+/)) {
    const email = candidate.replace(/^mailto:/i, "").replace(/^[<("']+|[>)"'.]+$/g, "").toLowerCase();
    if (email.length <= 254 && EMAIL_PATTERN.test(email)) return email;
  }
  return null;
}

/** Site sem espaços, com host em minúsculas; e-mails e textos sem domínio → null. */
export function normalizeWebsite(value: unknown): string | null {
  const text = cleanString(value);
  if (!text || text.includes("@") || /\s/.test(text)) return null;
  const match = text.match(/^(https?:\/\/)?([^/?#]+)(.*)$/i);
  if (!match) return null;
  const host = match[2].toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(host)) return null;
  return `${match[1] ? match[1].toLowerCase() : ""}${host}${match[3] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Endereço
// ---------------------------------------------------------------------------

/** CEP com 8 dígitos (completa zero à esquerda quando perdido); inválido → null. */
export function normalizeCep(value: unknown): string | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : cleanString(value);
  if (!text) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.length === 7) digits = digits.padStart(8, "0");
  if (!/^\d{8}$/.test(digits) || /^0{8}$/.test(digits)) return null;
  return digits;
}

export function formatCep(value: unknown): string | null {
  const cep = normalizeCep(value);
  return cep ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null;
}

const UF_BY_NAME: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF",
  "espirito santo": "ES", goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO"
};

export const BRAZILIAN_UFS: ReadonlySet<string> = new Set(Object.values(UF_BY_NAME));

/** UF de duas letras (aceita nome por extenso, com ou sem acento). Desconhecida → null. */
export function normalizeUf(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const upper = text.toUpperCase();
  if (BRAZILIAN_UFS.has(upper)) return upper;
  return UF_BY_NAME[foldText(text)] ?? null;
}

/** Nome de município limpo e em title case pt-BR (acentos da fonte preservados). */
export function normalizeMunicipalityName(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  // "SAO PAULO/SP" ou "SAO PAULO - SP": remove a UF anexada.
  const withoutUf = text.replace(/\s*[/-]\s*([A-Za-z]{2})$/, (match, uf: string) => (BRAZILIAN_UFS.has(uf.toUpperCase()) ? "" : match));
  return toPtBrTitleCase(withoutUf);
}

/** Código IBGE de município (7 dígitos). */
export function normalizeIbgeCode(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  return /^\d{7}$/.test(digits) ? digits : null;
}

/** Número do endereço: "S/N", "SN", "0", "sem numero" → "S/N". */
export function normalizeAddressNumber(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const folded = foldText(text).replace(/[\s.]/g, "");
  if (["s/n", "sn", "s/no", "semnumero", "semn", "0", "00", "000"].includes(folded)) return "S/N";
  return text;
}

/** Texto de endereço (logradouro, bairro, complemento): limpo, caixa da fonte preservada. */
export function normalizeAddressText(value: unknown): string | null {
  const text = cleanString(value);
  return text ? text.replace(/\s*,\s*/g, ", ").replace(/,\s*$/, "") || null : null;
}

// ---------------------------------------------------------------------------
// Empresa
// ---------------------------------------------------------------------------

/** Razão social / nome fantasia: limpa aspas externas e espaços; caixa da fonte preservada. */
export function normalizeCompanyName(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const unquoted = text
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^["']+|["']+$/g, "")
    .trim();
  return unquoted || null;
}

/** CNAE subclasse com 7 dígitos (completa zero à esquerda perdido: 111301 → 0111301). */
export function normalizeCnae(value: unknown): string | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : cleanString(value);
  if (!text) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.length === 6) digits = digits.padStart(7, "0");
  return /^\d{7}$/.test(digits) && !/^0{7}$/.test(digits) ? digits : null;
}

export function formatCnae(value: unknown): string | null {
  const cnae = normalizeCnae(value);
  return cnae ? `${cnae.slice(0, 4)}-${cnae.slice(4, 5)}/${cnae.slice(5)}` : null;
}

/** Data ISO (AAAA-MM-DD) a partir de ISO ou DD/MM/AAAA; datas impossíveis → null. */
export function normalizeIsoDate(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : br ? [br[3], br[2], br[1]] : [];
  if (!year) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  if (Number(year) < 1800) return null;
  return `${year}-${month}-${day}`;
}
