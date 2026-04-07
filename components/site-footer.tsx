import Link from "next/link";
import { footerNavigation, getBusinessShortDescription, publicContactEmail } from "@/lib/site-content";

export function SiteFooter() {
  return (
    <footer className="container footer">
      <div className="surface-premium card-lg footer-premium-shell">
        <div className="footer-grid footer-grid-expanded">
          <div className="stack" style={{ gap: 14 }}>
            <span className="eyebrow">BuscaCNAE</span>
            <strong style={{ fontSize: "1.45rem", letterSpacing: "-0.04em" }}>
              Descubra, filtre e compre listas B2B por CNAE e região com preço transparente antes do pagamento.
            </strong>
            <span className="muted">{getBusinessShortDescription()}</span>
            <div className="inline-list">
              <span className="pill">Pesquisa pública</span>
              <span className="pill">Checkout com prévia</span>
              <span className="pill">Dashboard opcional</span>
            </div>
          </div>

          <div className="stack">
            <span className="footer-heading">Produto</span>
            {footerNavigation.product.map((item) => (
              <Link key={item.href} href={item.href} className="muted">
                {item.label}
              </Link>
            ))}
          </div>

          <div className="stack">
            <span className="footer-heading">Confiança</span>
            {footerNavigation.trust.map((item) => (
              <Link key={item.href} href={item.href} className="muted">
                {item.label}
              </Link>
            ))}
          </div>

          <div className="stack">
            <span className="footer-heading">Casos de uso</span>
            {footerNavigation.useCases.map((item) => (
              <Link key={item.href} href={item.href} className="muted">
                {item.label}
              </Link>
            ))}
          </div>

          <div className="stack">
            <span className="footer-heading">Contato</span>
            <a href={`mailto:${publicContactEmail}`} className="muted">
              {publicContactEmail}
            </a>
            <span className="muted">Atendimento comercial, suporte e dúvidas sobre dados.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
