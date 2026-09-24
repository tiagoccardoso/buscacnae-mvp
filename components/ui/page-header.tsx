import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  align?: "start" | "center";
  size?: "hero" | "large";
  as?: "h1" | "h2";
};

/**
 * Cabeçalho de página: eyebrow → título → descrição curta → ações.
 * Um único padrão para todas as páginas públicas e internas.
 */
export function PageHeader({ eyebrow, title, lead, actions, align = "start", size = "large", as = "h1" }: PageHeaderProps) {
  const Heading = as;

  return (
    <header className={`page-header enter${align === "center" ? " page-header-center" : ""}`}>
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <Heading className={size === "hero" ? "title-hero" : "title-large"}>{title}</Heading>
      {lead ? <p className="lead">{lead}</p> : null}
      {actions ? <div className="cluster">{actions}</div> : null}
    </header>
  );
}
