"use client";

import { percentOf, type RegionStats } from "@/lib/map/intelligence/region-stats";
import { PRECISION_LABELS } from "@/lib/map/types";

const numberFormat = new Intl.NumberFormat("pt-BR");

function formatDateBr(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function Share({ part, whole }: { part: number; whole: number }) {
  const percent = percentOf(part, whole);
  return percent === null ? null : <span className="footnote"> · {percent}%</span>;
}

type RegionInsightsProps = {
  stats: RegionStats;
  /** Rótulo curto do recorte ("nesta célula", "no município", "na busca"). */
  scopeLabel: string;
  headingLevel?: "h3" | "h4";
};

/**
 * Indicadores de um recorte territorial. Só mostra o que é calculável com os campos
 * da busca; campos ausentes aparecem como "não informado" e saem dos percentuais.
 */
export function RegionInsights({ stats, scopeLabel, headingLevel = "h4" }: RegionInsightsProps) {
  const Heading = headingLevel;
  const statusKnown = stats.status.active + stats.status.inactive;
  const sizeKnown = stats.total - stats.sizeUnknown;
  const maxSize = stats.bySize.reduce((max, item) => Math.max(max, item.count), 1);
  const maxCnae = stats.topCnaes.reduce((max, item) => Math.max(max, item.count), 1);

  return (
    <div className="map-insights">
      <dl className="map-stats map-insights-kpis">
        <div>
          <dt>Empresas</dt>
          <dd className="numeric">{numberFormat.format(stats.total)}</dd>
        </div>
        <div>
          <dt>Ativas</dt>
          <dd className="numeric">
            {statusKnown ? numberFormat.format(stats.status.active) : "—"}
            <Share part={stats.status.active} whole={statusKnown} />
          </dd>
        </div>
        <div>
          <dt title={`Abertas desde ${formatDateBr(stats.newCompanies.since)}`}>Novas (12 meses)</dt>
          <dd className="numeric">
            {stats.newCompanies.known ? numberFormat.format(stats.newCompanies.count) : "—"}
            <Share part={stats.newCompanies.count} whole={stats.newCompanies.known} />
          </dd>
        </div>
      </dl>

      {stats.status.unknown > 0 || stats.newCompanies.known < stats.total ? (
        <p className="footnote">
          {stats.status.unknown > 0 ? `${numberFormat.format(stats.status.unknown)} sem situação informada. ` : ""}
          {stats.newCompanies.known < stats.total
            ? `${numberFormat.format(stats.total - stats.newCompanies.known)} sem data de abertura (fora do cálculo de novas).`
            : ""}
        </p>
      ) : null}

      <section className="stack-xs" aria-label={`Principais CNAEs ${scopeLabel}`}>
        <Heading className="field-label">Principais CNAEs {scopeLabel}</Heading>
        {stats.topCnaes.length === 0 ? (
          <p className="footnote">CNAE não informado.</p>
        ) : (
          <ol className="map-bars">
            {stats.topCnaes.map((item) => (
              <li key={item.key}>
                <span className="map-bar-label">{item.label}</span>
                <span className="map-bar-track" aria-hidden="true">
                  <span className="map-bar-fill" style={{ width: `${Math.max(4, (item.count / maxCnae) * 100)}%` }} />
                </span>
                <span className="map-bar-value numeric">{numberFormat.format(item.count)}</span>
              </li>
            ))}
          </ol>
        )}
        {stats.distinctCnaes > stats.topCnaes.length ? (
          <p className="footnote">{numberFormat.format(stats.distinctCnaes)} CNAEs principais diferentes no recorte.</p>
        ) : null}
      </section>

      <section className="stack-xs" aria-label={`Distribuição por porte ${scopeLabel}`}>
        <Heading className="field-label">Porte</Heading>
        {stats.bySize.length === 0 ? (
          <p className="footnote">Porte não informado.</p>
        ) : (
          <ul className="map-bars">
            {stats.bySize.map((item) => (
              <li key={item.key}>
                <span className="map-bar-label">{item.label}</span>
                <span className="map-bar-track" aria-hidden="true">
                  <span className="map-bar-fill" style={{ width: `${Math.max(4, (item.count / maxSize) * 100)}%` }} />
                </span>
                <span className="map-bar-value numeric">
                  {numberFormat.format(item.count)}
                  <Share part={item.count} whole={sizeKnown} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {stats.sizeUnknown > 0 ? <p className="footnote">{numberFormat.format(stats.sizeUnknown)} sem porte informado.</p> : null}
      </section>

      {stats.approximate > 0 ? (
        <p className="map-precision-note is-approximate">
          <span className="map-legend-swatch" data-variant="approximate" aria-hidden="true" />
          {numberFormat.format(stats.approximate)} de {numberFormat.format(stats.total - stats.withoutLocation)} com localização aproximada (
          {[
            stats.precision.postal_code ? `${numberFormat.format(stats.precision.postal_code)} ${PRECISION_LABELS.postal_code.toLowerCase()}` : null,
            stats.precision.city ? `${numberFormat.format(stats.precision.city)} ${PRECISION_LABELS.city.toLowerCase()}` : null,
            stats.precision.approximate ? `${numberFormat.format(stats.precision.approximate)} só estado` : null
          ]
            .filter(Boolean)
            .join(", ")}
          ).
        </p>
      ) : null}
    </div>
  );
}
