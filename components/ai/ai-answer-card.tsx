"use client";

import Link from "next/link";
import { useMemo } from "react";
import { EChart, useChartPalette } from "@/components/intelligence/echart";
import { columnChartModel, rankingChartModel } from "@/lib/analytics/chart-options";
import type { AiAction, AiAnswer, AiBlock, AiProvenance } from "@/lib/ai/types";

const numberFormat = new Intl.NumberFormat("pt-BR");
const moneyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const PROVENANCE_LABELS: Record<AiProvenance, string> = { dado: "Dado", calculo: "Cálculo", ia: "Interpretação da IA" };

const PROVENANCE_HINTS: Record<AiProvenance, string> = {
  dado: "Lido diretamente dos registros da Casa dos Dados desta busca.",
  calculo: "Contagem, percentual ou mediana calculados pelo motor determinístico do BuscaCNAE.",
  ia: "Texto gerado pelo modelo de linguagem a partir dos números calculados; confira a tabela."
};

export function ProvenanceTag({ kind }: { kind: AiProvenance }) {
  return (
    <span className={`ai-tag ai-tag-${kind}`} title={PROVENANCE_HINTS[kind]}>
      {PROVENANCE_LABELS[kind]}
    </span>
  );
}

function formatDay(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return day ? `${day}/${month}/${year}` : value;
}

function RankingBlock({ block }: { block: Extract<AiBlock, { type: "ranking" }> }) {
  const palette = useChartPalette();
  const model = useMemo(() => {
    if (!palette || !block.chart || block.total === 0) return null;
    const noSelection = { palette, isSelected: () => false, hasSelection: false, total: block.total };
    return block.chart === "column"
      ? columnChartModel(
          block.rows.filter((row) => row.filterable),
          { ...noSelection, rotateLabels: block.rows.length > 12, height: 220 }
        )
      : rankingChartModel(block.rows, { ...noSelection, maxItems: block.rows.length, labelWidth: 130 });
  }, [palette, block]);

  return (
    <section className="ai-block" aria-label={block.title}>
      <header className="ai-block-head">
        <h4 className="ai-block-title">{block.title}</h4>
        <ProvenanceTag kind={block.provenance} />
      </header>
      {model ? <EChart model={model} label={`${block.title}: gráfico de barras`} /> : null}
      {block.total > 0 ? (
        <details className="ai-table-toggle" open={!block.chart}>
          <summary>{block.chart ? "Ver dados em tabela" : "Tabela"}</summary>
          <div className="ai-table-wrap">
            <table className="ai-table">
              <caption className="sr-only">{block.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Segmento</th>
                  <th scope="col" className="numeric">
                    Empresas
                  </th>
                  <th scope="col" className="numeric">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td className="numeric">{numberFormat.format(row.count)}</td>
                    <td className="numeric">{row.share === null ? "—" : percentFormat.format(row.share)}</td>
                  </tr>
                ))}
                {block.others ? (
                  <tr>
                    <th scope="row">
                      Outros {numberFormat.format(block.others.segments)} segmentos
                    </th>
                    <td className="numeric">{numberFormat.format(block.others.count)}</td>
                    <td className="numeric">{percentFormat.format(block.others.count / Math.max(1, block.total))}</td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="numeric">{numberFormat.format(block.total)}</td>
                  <td className="numeric">{block.total > 0 ? percentFormat.format(1) : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Block({ block, companyHrefBase }: { block: AiBlock; companyHrefBase: string | null }) {
  switch (block.type) {
    case "kpis":
      return (
        <dl className="ai-kpis">
          {block.items.map((item) => (
            <div key={item.label} className="ai-kpi">
              <dt>
                {item.label} <ProvenanceTag kind={item.provenance} />
              </dt>
              <dd>
                <span className="ai-kpi-value">{item.value}</span>
                {item.detail ? <span className="ai-kpi-detail">{item.detail}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      );
    case "ranking":
      return <RankingBlock block={block} />;
    case "comparison":
      return (
        <section className="ai-block" aria-label="Comparação entre regiões">
          <header className="ai-block-head">
            <h4 className="ai-block-title">Comparação</h4>
            <ProvenanceTag kind="calculo" />
          </header>
          <div className="ai-table-wrap">
            <table className="ai-table">
              <thead>
                <tr>
                  <th scope="col">Indicador</th>
                  {block.columns.map((column) => (
                    <th key={column.key} scope="col" className="numeric">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.metric}>
                    <th scope="row" title={row.note}>
                      {row.metric}
                    </th>
                    {row.values.map((value, index) => (
                      <td key={block.columns[index]?.key ?? index} className="numeric">
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    case "companies":
      return (
        <section className="ai-block" aria-label="Empresas">
          <header className="ai-block-head">
            <h4 className="ai-block-title">
              {block.rows.length < block.total
                ? `${numberFormat.format(block.rows.length)} de ${numberFormat.format(block.total)} empresas`
                : `${numberFormat.format(block.total)} empresa${block.total === 1 ? "" : "s"}`}{" "}
              <span className="ai-muted">· {block.sortLabel}</span>
            </h4>
            <ProvenanceTag kind={block.provenance} />
          </header>
          <ol className="ai-company-list">
            {block.rows.map((row) => (
              <li key={row.id}>
                <div className="ai-company-name">
                  {companyHrefBase ? (
                    <Link href={`${companyHrefBase}${encodeURIComponent(row.cnpj)}`} prefetch={false}>
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </div>
                <div className="ai-company-meta">
                  {[
                    [row.city, row.state].filter(Boolean).join("/"),
                    row.status,
                    row.size,
                    row.openedAt ? `aberta em ${formatDay(row.openedAt)}` : null,
                    row.capital !== null ? `capital ${moneyFormat.format(row.capital)}` : null
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {row.cnae ? <div className="ai-company-meta">{row.cnae}</div> : null}
              </li>
            ))}
          </ol>
        </section>
      );
  }
}

type AiAnswerCardProps = {
  answer: AiAnswer;
  companyHrefBase: string | null;
  onAction(action: AiAction): void;
  onAsk(question: string, options?: { reset?: boolean }): void;
  commandApplied: boolean;
};

export function AiAnswerCard({ answer, companyHrefBase, onAction, onAsk, commandApplied }: AiAnswerCardProps) {
  const transparency = answer.transparency;
  const tone = answer.status === "unsupported" ? "ai-answer-unsupported" : answer.status === "clarify" ? "ai-answer-clarify" : "";
  return (
    <article className={`ai-answer ${tone}`.trim()} aria-label="Resposta do assistente">
      <p className="ai-headline">{answer.headline}</p>

      {answer.uiCommand && commandApplied ? (
        <p className="ai-applied" role="status">
          Aplicado na tela: {answer.uiCommand.label}
        </p>
      ) : null}

      {answer.blocks.map((block, index) => (
        <Block key={`${block.type}-${index}`} block={block} companyHrefBase={companyHrefBase} />
      ))}

      {answer.interpretation ? (
        <aside className="ai-interpretation" aria-label="Interpretação da IA">
          <ProvenanceTag kind="ia" />
          <p>{answer.interpretation}</p>
          <p className="ai-muted">Gerado por IA a partir dos números acima (verificados). Não é recomendação.</p>
        </aside>
      ) : null}

      {answer.actions.length > 0 ? (
        <div className="ai-actions">
          {answer.actions.map((action) =>
            "href" in action ? (
              <Link key={action.label} href={action.href} className="button-secondary button-sm">
                {action.label}
              </Link>
            ) : (
              <button key={action.label} type="button" className="button-secondary button-sm" onClick={() => onAction(action)}>
                {action.label}
              </button>
            )
          )}
        </div>
      ) : null}

      {transparency ? (
        <details className="ai-transparency">
          <summary>
            Base: {numberFormat.format(transparency.analyzed)} de {numberFormat.format(transparency.universe)} empresas · Como calculei
          </summary>
          <dl className="ai-transparency-list">
            <div>
              <dt>Filtros aplicados</dt>
              <dd>{transparency.filters.length > 0 ? transparency.filters.join(" · ") : "Nenhum (universo completo)"}</dd>
            </div>
            {transparency.inherited.length > 0 ? (
              <div>
                <dt>Herdados do contexto</dt>
                <dd>
                  {transparency.inherited.join(" · ")}{" "}
                  <button type="button" className="button-ghost button-sm" onClick={() => onAsk(answer.question, { reset: true })}>
                    Perguntar sem contexto
                  </button>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Universo analisado</dt>
              <dd>
                {numberFormat.format(transparency.universe)} empresas
                {transparency.universeCounts && transparency.universeCounts.reported > transparency.universe
                  ? ` (a Casa dos Dados informou ${numberFormat.format(transparency.universeCounts.reported)}; veja “Por que este número?”)`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Quantidade analisada</dt>
              <dd>{numberFormat.format(transparency.analyzed)} empresas passaram pelos filtros</dd>
            </div>
            <div>
              <dt>Período</dt>
              <dd>{transparency.period ?? "Todas as datas de abertura"}</dd>
            </div>
            <div>
              <dt>Data de referência</dt>
              <dd>{formatDay(transparency.referenceDate)} (America/Sao_Paulo)</dd>
            </div>
            <div>
              <dt>Fonte</dt>
              <dd>{transparency.source}</dd>
            </div>
            {transparency.notes.length > 0 ? (
              <div>
                <dt>Como entendi</dt>
                <dd>
                  <ul className="ai-notes">
                    {transparency.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Motor</dt>
              <dd>
                {answer.tool ? <code>{answer.tool}</code> : null} · planejado por{" "}
                {answer.engine.interpreter === "llm" ? `IA (${answer.engine.model ?? "modelo"})` : answer.engine.fallback ? "regras (IA indisponível)" : "regras"} ·
                números calculados sem IA · {numberFormat.format(answer.engine.ms)} ms
              </dd>
            </div>
          </dl>
        </details>
      ) : null}

      {answer.followUps.length > 0 ? (
        <div className="ai-followups" aria-label="Sugestões de próxima pergunta">
          {answer.followUps.map((question) => (
            <button key={question} type="button" className="ai-chip" onClick={() => onAsk(question)}>
              {question}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
