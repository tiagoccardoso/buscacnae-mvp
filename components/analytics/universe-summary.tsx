import { describeUniverse, type UniverseCounts } from "@/lib/analytics/universe";

const numberFormat = new Intl.NumberFormat("pt-BR");

type UniverseSummaryProps = {
  counts: UniverseCounts;
  /** Empresas que passam pelos filtros atuais (quando a visão já filtrou). */
  filteredCount?: number | null;
  className?: string;
};

/**
 * Reconciliação do universo analisado — o MESMO bloco na Lista, no Mapa e na Inteligência.
 * Explica cada diferença entre o total informado pela Casa dos Dados e o que está sendo
 * analisado, para nunca haver "Mapa = 5.200 / Dashboard = 5.187 / Lista = 5.231" sem motivo.
 * Componente sem estado (renderiza no servidor e no cliente).
 */
export function UniverseSummary({ counts, filteredCount = null, className = "" }: UniverseSummaryProps) {
  const notes = describeUniverse(counts);
  const filtered = filteredCount !== null && filteredCount !== counts.analyzed;
  return (
    <details className={`universe-summary ${className}`.trim()}>
      <summary>
        <span className="universe-summary-main">
          Universo analisado: <strong className="numeric">{numberFormat.format(counts.analyzed)}</strong>{" "}
          {counts.analyzed === 1 ? "empresa" : "empresas"}
          {filtered ? (
            <>
              {" "}
              · <strong className="numeric">{numberFormat.format(filteredCount)}</strong> com os filtros atuais
            </>
          ) : null}
        </span>
        <span className="footnote universe-summary-hint">{notes.length > 0 ? "Por que este número?" : "Como é calculado"}</span>
      </summary>
      <div className="universe-summary-body">
        <dl className="universe-lines">
          <div>
            <dt>Informadas pela Casa dos Dados</dt>
            <dd className="numeric">{numberFormat.format(counts.reported)}</dd>
          </div>
          <div>
            <dt>Gravadas nesta busca</dt>
            <dd className="numeric">{numberFormat.format(counts.stored)}</dd>
          </div>
          {notes.map((note) => (
            <div key={note.key}>
              <dt>{note.key === "not-stored" ? "Informadas, mas não carregadas na busca (limite por busca)" : note.text.charAt(0).toUpperCase() + note.text.slice(1)}</dt>
              <dd className="numeric">
                {note.key === "not-stored" ? "" : "− "}
                {numberFormat.format(note.count)}
              </dd>
            </div>
          ))}
          <div className="universe-lines-total">
            <dt>Universo analisado (Empresas, Mapa e Inteligência)</dt>
            <dd className="numeric">{numberFormat.format(counts.analyzed)}</dd>
          </div>
        </dl>
        <p className="footnote">
          As três visões usam exatamente estas empresas e os mesmos filtros da URL. O mapa ainda indica quantas não têm localização: elas
          continuam no universo e na lista, só não viram ponto no mapa.
        </p>
      </div>
    </details>
  );
}
