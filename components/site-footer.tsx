import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="container footer">
      <div className="surface-premium card-lg footer-premium-shell">
        <div className="footer-grid">
          <div className="stack" style={{ gap: 14 }}>
            <span className="eyebrow">BuscaCNAE</span>
            <strong style={{ fontSize: "1.45rem", letterSpacing: "-0.04em" }}>
              Pesquisa empresarial por CNAE com preço simples e foco em prospecção.
            </strong>
            <span className="muted">
              Filtre por CNAE, estado e cidade, veja quantos CNPJs foram encontrados e pague apenas pelo que a pesquisa retornar.
            </span>
          </div>

          <div className="stack">
            <span className="footer-heading">Fluxo</span>
            <span className="muted">Pesquisar</span>
            <span className="muted">Ver o valor</span>
            <span className="muted">Liberar a lista</span>
          </div>

          <div className="stack">
            <span className="footer-heading">Recursos extras</span>
            <Link href="/onboarding" className="muted">Onboarding corporativo</Link>
            <Link href="/dashboard" className="muted">Dashboard opcional</Link>
            <Link href="/pricing" className="muted">Modelo de preço</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
