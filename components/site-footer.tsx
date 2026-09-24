import Link from "next/link";
import { getAppName } from "@/lib/env";
import { footerNavigation, getBusinessShortDescription } from "@/lib/site-content";

const columns = [
  { title: "Produto", items: footerNavigation.product },
  { title: "Confiança", items: footerNavigation.trust },
  { title: "Casos de uso", items: footerNavigation.useCases }
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <span className="brand">
              <span className="brand-mark" aria-hidden="true">BC</span>
              <span>{getAppName()}</span>
            </span>
            <p>
              Descubra, filtre e compre listas B2B por CNAE e região com preço transparente antes do pagamento.
            </p>
            <p>{getBusinessShortDescription()}</p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <span className="footer-heading">{column.title}</span>
              <ul className="footer-links">
                {column.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="footer-bottom">
          <span>Pesquisa pública · Checkout com prévia · Dashboard opcional</span>
          <span>
            Atendimento humanizado: registre tickets na plataforma{" "}
            <a href="https://www.selectsaas.com.br" target="_blank" rel="noopener noreferrer">
              SelectSaaS
            </a>
            .
          </span>
        </div>
      </div>
    </footer>
  );
}
