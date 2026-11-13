import { isValidCnpj, normalizeCnpjValue, normalizeEmail, normalizeWebsite } from "@/lib/data-quality/normalize";
import { normalizeWhatsappNumber } from "@/lib/whatsapp";
import { cleanText, parseAmountToCents, parseDateOnly, parseLocalDateTime } from "./input";

/**
 * Prospects manuais (Fase 8). Dados INFORMADOS PELO USUÁRIO — nunca gravados em
 * establishments. Toda entrada passa por `parseProspectInput` antes do banco.
 */

export type ProspectKind = "company" | "person";
export type ProspectOrigin = "buscacnae" | "manual" | "referral" | "whatsapp" | "visit" | "phone" | "website" | "social" | "event" | "import" | "other";
export type DealPriority = "low" | "normal" | "high";

export const PROSPECT_ORIGIN_LABEL: Record<ProspectOrigin, string> = {
  buscacnae: "Busca BuscaCNAE",
  manual: "Cadastro manual",
  referral: "Indicação",
  whatsapp: "WhatsApp",
  visit: "Visita comercial",
  phone: "Telefone",
  website: "Site",
  social: "Redes sociais",
  event: "Evento",
  import: "Importação",
  other: "Outros"
};

export const PRIORITY_LABEL: Record<DealPriority, string> = { low: "Baixa", normal: "Normal", high: "Alta" };

export const BR_STATES = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"] as const;

export function isProspectOrigin(value: unknown): value is ProspectOrigin {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROSPECT_ORIGIN_LABEL, value);
}

export function isPriority(value: unknown): value is DealPriority {
  return value === "low" || value === "normal" || value === "high";
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

export function normalizeCpf(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

export function isValidCpf(value: unknown) {
  const cpf = normalizeCpf(value);
  if (!cpf || /^(\d)\1{10}$/.test(cpf)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(cpf[9]) && check(10) === Number(cpf[10]);
}

/** CPF mascarado para listas: ***.456.789-** (o completo só aparece na ficha do prospect). */
export function maskCpf(cpf: string) {
  return cpf.length === 11 ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : "";
}

export function formatCpf(cpf: string) {
  return cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : cpf;
}

/** Documento informado no formulário → {type, value} ou erro de validação. */
export function parseDocument(kind: ProspectKind, raw: unknown): { ok: true; type: "cnpj" | "cpf" | null; value: string | null } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, type: null, value: null };
  if (kind === "person") {
    if (!isValidCpf(text)) return { ok: false, error: "CPF inválido. Confira os dígitos ou deixe o campo em branco." };
    return { ok: true, type: "cpf", value: normalizeCpf(text) };
  }
  const cnpj = normalizeCnpjValue(text);
  if (!cnpj || !isValidCnpj(cnpj)) return { ok: false, error: "CNPJ inválido. Confira os dígitos ou deixe o campo em branco." };
  return { ok: true, type: "cnpj", value: cnpj };
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export type ProspectFields = {
  kind: ProspectKind;
  name: string;
  tradeName: string | null;
  documentType: "cnpj" | "cpf" | null;
  document: string | null;
  origin: ProspectOrigin;
  originDetail: string | null;
  segment: string | null;
  cityName: string | null;
  stateCode: string | null;
  address: string | null;
  contactName: string | null;
  contactRole: string | null;
  phone: string | null;
  whatsapp: string | null;
  phoneSecondary: string | null;
  email: string | null;
  website: string | null;
  tags: string[];
};

export type DealFields = {
  stageId: string | null;
  ownerProfileId: string | null;
  amountCents: number | null;
  expectedCloseDate: string | null;
  priority: DealPriority;
  nextContactAt: string | null;
  notes: string | null;
};

type Getter = (key: string) => unknown;

/** Telefone como digitado (sem letras), ou erro se não parecer um telefone. */
function parsePhone(raw: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > 40 || /[^\d\s()+.\-/]/.test(text) || text.replace(/\D/g, "").length < 8) {
    return { ok: false, error: `${label} inválido. Use somente números, espaços, parênteses, hífen e +.` };
  }
  return { ok: true, value: text };
}

export function parseTags(raw: unknown) {
  return Array.from(
    new Set(
      String(raw ?? "")
        .split(/[,;\n]/)
        .map((tag) => tag.trim().replace(/\s+/g, " ").slice(0, 40))
        .filter(Boolean)
    )
  ).slice(0, 20);
}

/**
 * Valida e normaliza o formulário de prospect. Retorna a primeira mensagem de erro
 * (as mensagens começam com prefixos conhecidos por lib/crm/messages.ts).
 */
export function parseProspectInput(get: Getter): { ok: true; prospect: ProspectFields } | { ok: false; error: string } {
  const kind: ProspectKind = get("kind") === "person" ? "person" : "company";
  const name = cleanText(get("name"), 160);
  if (!name) return { ok: false, error: kind === "person" ? "Informe o nome da pessoa." : "Informe a razão social ou o nome da empresa." };

  const document = parseDocument(kind, get("document"));
  if (!document.ok) return document;

  const originRaw = String(get("origin") ?? "manual");
  if (!isProspectOrigin(originRaw)) return { ok: false, error: "Origem do prospect inválida." };

  const state = String(get("stateCode") ?? "").trim().toUpperCase();
  if (state && !(BR_STATES as readonly string[]).includes(state)) return { ok: false, error: "UF inválida." };

  const phones: Array<[string, string]> = [["phone", "Telefone principal"], ["whatsapp", "WhatsApp"], ["phoneSecondary", "Telefone adicional"]];
  const parsedPhones: Record<string, string | null> = {};
  for (const [key, label] of phones) {
    const result = parsePhone(get(key), label);
    if (!result.ok) return result;
    parsedPhones[key] = result.value;
  }
  if (parsedPhones.whatsapp && !normalizeWhatsappNumber(parsedPhones.whatsapp).ok) {
    return { ok: false, error: "WhatsApp inválido. Informe DDD + número (ou + e o código do país)." };
  }

  const emailRaw = String(get("email") ?? "").trim();
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  if (emailRaw && (!email || email !== emailRaw.toLowerCase().replace(/^mailto:/, ""))) return { ok: false, error: "E-mail inválido." };

  const websiteRaw = String(get("website") ?? "").trim();
  const website = websiteRaw ? normalizeWebsite(websiteRaw) : null;
  if (websiteRaw && !website) return { ok: false, error: "Site inválido. Ex.: www.empresa.com.br" };

  return {
    ok: true,
    prospect: {
      kind,
      name,
      tradeName: kind === "company" ? cleanText(get("tradeName"), 160) : null,
      documentType: document.type,
      document: document.value,
      origin: originRaw,
      originDetail: cleanText(get("originDetail"), 160),
      segment: cleanText(get("segment"), 120),
      cityName: cleanText(get("cityName"), 120),
      stateCode: state || null,
      address: cleanText(get("address"), 300),
      contactName: cleanText(get("contactName"), 120),
      contactRole: cleanText(get("contactRole"), 120),
      phone: parsedPhones.phone,
      whatsapp: parsedPhones.whatsapp,
      phoneSecondary: parsedPhones.phoneSecondary,
      email,
      website: website ? website.slice(0, 300) : null,
      tags: parseTags(get("tags"))
    }
  };
}

export function parseDealFields(get: Getter): { ok: true; deal: DealFields } | { ok: false; error: string } {
  const amount = parseAmountToCents(get("amount"));
  if (amount === undefined) return { ok: false, error: "Valor inválido. Use o formato 12.500,00." };
  const priority = String(get("priority") ?? "normal");
  const nextRaw = String(get("nextContactAt") ?? "").trim();
  const nextContactAt = nextRaw ? parseLocalDateTime(nextRaw) : null;
  if (nextRaw && !nextContactAt) return { ok: false, error: "Data do próximo contato inválida." };
  const expectedRaw = String(get("expectedCloseDate") ?? "").trim();
  const expectedCloseDate = expectedRaw ? parseDateOnly(expectedRaw) : null;
  if (expectedRaw && !expectedCloseDate) return { ok: false, error: "Previsão de fechamento inválida." };
  return {
    ok: true,
    deal: {
      stageId: String(get("stageId") ?? "") || null,
      ownerProfileId: String(get("ownerProfileId") ?? "") || null,
      amountCents: amount,
      expectedCloseDate,
      priority: isPriority(priority) ? priority : "normal",
      nextContactAt,
      notes: cleanText(get("notes"), 5000)
    }
  };
}

/**
 * Chaves para detectar duplicidade. Telefones comparados pelos dígitos do link
 * WhatsApp (com DDI), então "(41) 99999-8888" e "+55 41 99999 8888" colidem.
 * Nunca há mescla automática: o resultado só é exibido para o usuário decidir.
 */
export function duplicateKeys(input: { document?: string | null; phones?: Array<string | null | undefined>; email?: string | null }) {
  const phones = Array.from(
    new Set(
      (input.phones ?? [])
        .map((phone) => normalizeWhatsappNumber(phone))
        .filter((number): number is Extract<typeof number, { ok: true }> => number.ok)
        .map((number) => number.digits)
    )
  );
  return { document: input.document || null, phones, email: input.email ? input.email.toLowerCase() : null };
}

/** Rótulo de exibição do prospect (nome fantasia > nome). */
export function prospectDisplayName(prospect: { name: string; tradeName: string | null }) {
  return prospect.tradeName || prospect.name;
}
