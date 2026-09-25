export default function SearchResultLoading() {
  return (
    <section className="section" aria-busy="true" aria-live="polite">
      <div className="section-header">
        <span className="eyebrow">Resultado da busca</span>
        <h2 className="title-1">Carregando empresas…</h2>
        <p className="footnote cluster">
          <span className="spinner" aria-hidden="true" /> Preparando a lista a partir da Casa dos Dados.
        </p>
      </div>
    </section>
  );
}
