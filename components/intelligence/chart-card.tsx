"use client";

import { useId, type ReactNode } from "react";

const numberFormat = new Intl.NumberFormat("pt-BR");

export type ChartTableRow = {
  key: string;
  label: string;
  count: number;
  /** Texto extra (ex.: acumulado). */
  extra?: string;
  filterable: boolean;
  selected: boolean;
};

type ChartCardProps = {
  title: string;
  /** Leitura/nota de origem (quantas têm o dado, regra aplicada…). */
  note?: ReactNode;
  /** Filtro desta dimensão está ativo. */
  filtered?: boolean;
  onClear?(): void;
  children: ReactNode;
  rows: ChartTableRow[];
  total: number;
  extraHeader?: string;
  onSelect?(key: string): void;
  className?: string;
};

/**
 * Cartão de gráfico da Inteligência: título, gráfico ECharts e a MESMA informação em
 * tabela (acessível por teclado e leitor de tela, com botão "Filtrar" por linha — o
 * drill-down não depende do mouse nem do gráfico).
 */
export function ChartCard({ title, note, filtered, onClear, children, rows, total, extraHeader, onSelect, className = "" }: ChartCardProps) {
  const titleId = useId();
  return (
    <section className={`intel-card ${className}`.trim()} aria-labelledby={titleId}>
      <header className="intel-card-head">
        <h3 id={titleId} className="headline">
          {title}
        </h3>
        {filtered && onClear ? (
          <button type="button" className="button-ghost button-sm" onClick={onClear}>
            Limpar filtro
          </button>
        ) : null}
      </header>
      {note ? <p className="footnote intel-card-note">{note}</p> : null}
      {total === 0 ? <p className="footnote">Nenhuma empresa com esses filtros.</p> : children}
      {rows.length > 0 ? (
        <details className="intel-table-toggle">
          <summary>Ver dados em tabela</summary>
          <div className="intel-table-wrap">
            <table className="intel-table">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  <th scope="col">Segmento</th>
                  <th scope="col" className="numeric">
                    Empresas
                  </th>
                  <th scope="col" className="numeric">
                    %
                  </th>
                  {extraHeader ? (
                    <th scope="col" className="numeric">
                      {extraHeader}
                    </th>
                  ) : null}
                  {onSelect ? (
                    <th scope="col">
                      <span className="sr-only">Ação</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} aria-selected={row.selected || undefined}>
                    <th scope="row">{row.label}</th>
                    <td className="numeric">{numberFormat.format(row.count)}</td>
                    <td className="numeric">
                      {total > 0 ? `${((row.count / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—"}
                    </td>
                    {extraHeader ? <td className="numeric">{row.extra ?? ""}</td> : null}
                    {onSelect ? (
                      <td>
                        {row.filterable && row.count > 0 ? (
                          <button type="button" className="button-ghost button-sm" onClick={() => onSelect(row.key)} aria-pressed={row.selected}>
                            {row.selected ? "Remover filtro" : "Filtrar"}
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="numeric">{numberFormat.format(total)}</td>
                  <td className="numeric">{total > 0 ? "100,0%" : "—"}</td>
                  {extraHeader ? <td /> : null}
                  {onSelect ? <td /> : null}
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
