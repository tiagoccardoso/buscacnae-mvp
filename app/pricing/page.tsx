import Link from "next/link";

export default function PricingPage() {
  return (
    <main className="page">
      <section className="container stack">
        <div className="surface-premium card-lg pricing-stage">
          <div className="stack" style={{ gap: 14 }}>
            <span className="eyebrow">Preço por resultado</span>
            <h1 className="section-title" style={{ fontSize: "2.6rem", marginBottom: 0 }}>
              Pague apenas <span className="gradient-text">R$ 0,05 por CNPJ encontrado</span>
            </h1>
            <p className="section-copy">
              A pesquisa é pública. Você informa os filtros, o sistema calcula a quantidade de resultados e o checkout libera a lista para visualização e download em XLSX após o pagamento.
            </p>
            <div className="inline-list">
              <span className="pill">Sem plano obrigatório</span>
              <span className="pill">Preço proporcional</span>
              <span className="pill">Dashboard opcional</span>
            </div>
          </div>

          <div className="pricing-display-card">
            <span className="kicker">Exemplo de cobrança</span>
            <strong>100 CNPJs = R$ 5,00</strong>
            <span className="muted">O valor acompanha o resultado da pesquisa e não obriga assinatura para a primeira conversão.</span>
          </div>
        </div>

        <div className="grid-3 responsive-feature-grid">
          <div className="surface-premium card stack">
            <span className="eyebrow">1. Pesquise</span>
            <p className="section-copy">Selecione CNAE, estado e cidade em um formulário mais claro, com opções carregadas automaticamente.</p>
          </div>
          <div className="surface-premium card stack">
            <span className="eyebrow">2. Veja o valor</span>
            <p className="section-copy">O sistema informa quantos CNPJs foram encontrados e calcula o total antes de qualquer pagamento.</p>
          </div>
          <div className="surface-premium card stack">
            <span className="eyebrow">3. Libere a lista</span>
            <p className="section-copy">Após o pagamento, a lista fica liberada imediatamente, com visualização online, download em XLSX e dashboard opcional para revisão posterior.</p>
          </div>
        </div>

        <div className="surface-premium card-lg panel-grid two">
          <div className="stack">
            <span className="eyebrow">Dashboard opcional</span>
            <h2 className="section-title">Use o dashboard para governança, não como barreira.</h2>
            <p className="section-copy">
              A experiência principal continua sendo a pesquisa pública. O dashboard entra para histórico, revisão de listas e navegação detalhada de pesquisas anteriores.
            </p>
          </div>
          <div className="inline-actions" style={{ alignItems: "flex-end", justifyContent: "flex-start" }}>
            <Link href="/" className="button">
              Fazer uma pesquisa agora
            </Link>
            <Link href="/onboarding" className="button-ghost">
              Ver onboarding corporativo
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
