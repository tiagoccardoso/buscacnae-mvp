import { normalizePhone } from "@/lib/data-quality/normalize";

/**
 * Telefone → link oficial do WhatsApp (https://wa.me/<número>).
 *
 * Regras (nada é gravado: o número armazenado continua exatamente como digitado):
 *   - "+" ou "00" no início = número internacional. +55 passa pela validação brasileira;
 *     outros países exigem de 8 a 15 dígitos (limite E.164) e código de país sem zero.
 *   - Sem "+": só é aceito se for um número brasileiro válido (DDD + 8/9 dígitos,
 *     com ou sem 0/operadora/55). Nesse caso o DDI 55 é acrescentado.
 *     Qualquer outro formato é recusado — o DDI 55 nunca é "chutado".
 *   - 0800/0300/0500/0900 e números inválidos não geram link.
 *
 * O link wa.me abre o aplicativo no celular (quando instalado) e o WhatsApp Web/desktop
 * no computador, com fallback para a página do WhatsApp no navegador.
 */

export type WhatsappNumber =
  | { ok: true; digits: string; country: "BR" | "INTL"; isMobile: boolean | null; display: string }
  | { ok: false; reason: "empty" | "invalid" | "toll_free" | "needs_country_code" };

const MAX_INPUT = 40;

export function normalizeWhatsappNumber(value: unknown): WhatsappNumber {
  const raw = typeof value === "string" ? value.trim().slice(0, MAX_INPUT) : typeof value === "number" ? String(value) : "";
  if (!raw || !/\d/.test(raw)) return { ok: false, reason: "empty" };
  // Só caracteres de telefone: evita aceitar textos com números embutidos.
  if (/[^\d\s()+.\-/]/.test(raw)) return { ok: false, reason: "invalid" };

  const compact = raw.replace(/[\s().\-/]/g, "");
  const international = compact.startsWith("+") || compact.startsWith("00");
  const digits = compact.replace(/^\+/, "").replace(/^00/, "").replace(/\D/g, "");
  if (compact.slice(1).includes("+")) return { ok: false, reason: "invalid" };

  if (international) {
    if (digits.startsWith("55")) return brazilian(digits.slice(2));
    if (!/^[1-9]\d{7,14}$/.test(digits)) return { ok: false, reason: "invalid" };
    return { ok: true, digits, country: "INTL", isMobile: null, display: `+${digits}` };
  }

  if (/^0[3589]00/.test(digits)) return { ok: false, reason: "toll_free" };
  const br = brazilian(digits);
  if (br.ok) return br;
  // Muitos dígitos e não é brasileiro: provavelmente internacional sem "+".
  return digits.length > 11 ? { ok: false, reason: "needs_country_code" } : br;
}

function brazilian(nationalDigits: string): WhatsappNumber {
  if (/^0[3589]00/.test(nationalDigits)) return { ok: false, reason: "toll_free" };
  const phone = normalizePhone(nationalDigits);
  if (!phone || !phone.ddd) return { ok: false, reason: "invalid" };
  return { ok: true, digits: `55${phone.digits}`, country: "BR", isMobile: phone.isMobile, display: `+55 ${phone.formatted}` };
}

export const WHATSAPP_REASON_LABEL: Record<Exclude<WhatsappNumber, { ok: true }>["reason"], string> = {
  empty: "Nenhum telefone informado.",
  invalid: "Telefone inválido para WhatsApp. Confira DDD e número.",
  toll_free: "Números 0800/0300 não funcionam no WhatsApp.",
  needs_country_code: "Para números de fora do Brasil, inclua + e o código do país."
};

/** Limite prático para a mensagem pré-preenchida (o link fica curto o bastante para qualquer navegador). */
export const WHATSAPP_MESSAGE_MAX = 1500;

/**
 * Monta o link oficial. Retorna null para número inválido — a interface não deve
 * renderizar um link nesse caso. A mensagem é opcional e sempre codificada.
 */
export function buildWhatsappUrl(phone: unknown, message?: string | null): string | null {
  const number = normalizeWhatsappNumber(phone);
  if (!number.ok) return null;
  const text = (message ?? "").replace(/\r\n/g, "\n").trim().slice(0, WHATSAPP_MESSAGE_MAX);
  return text ? `https://wa.me/${number.digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${number.digits}`;
}

/**
 * Primeiro número válido de uma lista (ex.: WhatsApp, depois celular, depois telefone).
 * Cada candidato pode conter vários telefones ("(11) 3333-4444 / (11) 99999-8888"), comum
 * em cadastros oficiais; celulares têm preferência sobre fixos dentro do mesmo campo.
 */
export function firstWhatsappNumber(...candidates: unknown[]) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const parts = candidate.split(/[;,|]|\s\/\s|\s+e\s+/i).map((part) => part.trim()).filter(Boolean);
    const valid = parts
      .map((raw) => ({ raw, number: normalizeWhatsappNumber(raw) }))
      .filter((item): item is { raw: string; number: Extract<WhatsappNumber, { ok: true }> } => item.number.ok);
    const best = valid.find((item) => item.number.isMobile !== false) ?? valid[0];
    if (best) return best;
  }
  return null;
}
