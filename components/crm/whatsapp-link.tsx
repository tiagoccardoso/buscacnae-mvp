import { buildWhatsappUrl, firstWhatsappNumber, normalizeWhatsappNumber } from "@/lib/whatsapp";

/** Glifo de balão de conversa com telefone, no estilo do WhatsApp (traço, herda a cor). */
export function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className="wa-icon">
      <path
        fill="currentColor"
        d="M12 2.2a9.8 9.8 0 0 0-8.4 14.8L2.3 21.7l4.8-1.3A9.8 9.8 0 1 0 12 2.2Zm0 17.8a8 8 0 0 1-4.1-1.1l-.3-.2-2.8.8.8-2.7-.2-.3A8 8 0 1 1 12 20Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c-.1-.1-.2-.2-.4-.3Z"
      />
    </svg>
  );
}

type Props = {
  phone: string | null | undefined;
  /** Nome para o rótulo acessível ("Conversar com Fulano no WhatsApp"). */
  name?: string;
  /** "icon": só o ícone (cards, tabelas). "inline": ícone + número formatado. */
  variant?: "icon" | "inline";
  className?: string;
};

/**
 * Link oficial wa.me em nova aba. Número inválido → não renderiza link (no modo
 * "inline" mostra só o texto, sem ação). Abrir o WhatsApp não registra nada no CRM.
 */
export function WhatsAppLink({ phone, name, variant = "inline", className = "" }: Props) {
  const best = firstWhatsappNumber(phone);
  const number = best ? best.number : normalizeWhatsappNumber(phone);
  const href = best ? buildWhatsappUrl(best.raw) : null;
  if (!number.ok || !href) {
    return variant === "inline" && phone ? <span className="muted">{phone}</span> : null;
  }
  const label = `Conversar${name ? ` com ${name}` : ""} no WhatsApp (${number.display}) — abre em nova aba`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`wa-link${variant === "icon" ? " is-icon" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
    >
      <WhatsAppIcon />
      {variant === "inline" ? <span className="numeric">{number.display}</span> : null}
    </a>
  );
}
