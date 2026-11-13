import { WHATSAPP_REASON_LABEL, buildWhatsappUrl, firstWhatsappNumber, normalizeWhatsappNumber } from "@/lib/whatsapp";

/**
 * Ação rápida de WhatsApp da listagem: primeiro número válido entre os candidatos
 * (normalizado no formato internacional, link oficial wa.me). Número ausente ou inválido
 * não gera link: devolve o motivo para a interface explicar a indisponibilidade.
 */
export function whatsappQuickAction(...candidates: Array<string | null | undefined>) {
  const best = firstWhatsappNumber(...candidates);
  if (best) {
    const url = buildWhatsappUrl(best.raw);
    if (url && best.number.ok) return { url, display: best.number.display, problem: null };
  }
  const provided = candidates.find((value) => typeof value === "string" && value.trim());
  if (!provided) return { url: null, display: null, problem: "Sem telefone cadastrado" };
  const check = normalizeWhatsappNumber(provided);
  return { url: null, display: null, problem: check.ok ? "Número sem WhatsApp válido" : WHATSAPP_REASON_LABEL[check.reason] };
}
