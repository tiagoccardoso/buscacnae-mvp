type DashboardImpactVisualsProps = {
  searchCount: number;
  leadCount: number;
  latestResults: number;
  latestCity: string;
};

function normalizeChartValue(value: number, maxValue: number) {
  if (maxValue <= 0) return 20;
  return Math.max(20, Math.round((value / maxValue) * 100));
}

export function DashboardImpactVisuals({
  searchCount,
  leadCount,
  latestResults,
  latestCity
}: DashboardImpactVisualsProps) {
  const maxValue = Math.max(searchCount, leadCount, latestResults, 1);
  const chart = [
    { label: "Buscas", value: searchCount },
    { label: "Leads", value: leadCount },
    { label: "Última lista", value: latestResults }
  ];

  return (
    <div className="dashboard-visual-grid">
      <div className="surface card-lg stack chart-shell">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Impacto operacional</span>
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            Volume visual da operação
          </h2>
          <p className="section-copy">
            Um resumo gráfico para leitura rápida do uso da plataforma, do estoque de leads e da última pesquisa executada.
          </p>
        </div>

        <div className="bar-chart">
          {chart.map((item) => {
            const height = normalizeChartValue(item.value, maxValue);
            return (
              <div className="bar-chart-item" key={item.label}>
                <span className="bar-chart-value">{item.value}</span>
                <div className="bar-chart-track">
                  <div className="bar-chart-fill" style={{ height: `${height}%` }} />
                </div>
                <span className="bar-chart-label">{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="surface card-lg stack radar-shell">
        <span className="eyebrow">Camada corporativa</span>
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          Panorama executivo
        </h2>
        <div className="radar-card">
          <div className="radar-grid" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="radar-core">
            <strong>{latestResults}</strong>
            <span>últimos resultados</span>
          </div>
        </div>
        <div className="metric-inline-grid">
          <div>
            <span className="kicker">Cidade mais recente</span>
            <strong>{latestCity || "—"}</strong>
          </div>
          <div>
            <span className="kicker">Leads ativos</span>
            <strong>{leadCount}</strong>
          </div>
          <div>
            <span className="kicker">Buscas totais</span>
            <strong>{searchCount}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
