import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { CrmHeader } from "@/components/crm/crm-header";
import { KanbanBoard, type BoardDeal } from "@/components/crm/kanban-board";
import { CrmUnavailable } from "@/components/crm/crm-unavailable";
import { ProspectList, type ProspectRow } from "@/components/crm/prospect-list";
import { moveDealAction, toggleTaskAction } from "@/app/dashboard/crm/actions";
import { formatCnpj, formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/crm/input";
import { readCrmFeedback } from "@/lib/crm/messages";
import { canDeleteDeal, canEditDeal, canMoveDeal, canUpdateTask } from "@/lib/crm/permissions";
import { listDeals, listMembers, listStages, listTasks, type DealFilters } from "@/lib/crm/repository";
import { getCrmSession } from "@/lib/crm/server";
import { SOURCE_LABEL, isDealSource } from "@/lib/crm/timeline";
import { PROSPECT_ORIGIN_LABEL, isProspectOrigin } from "@/lib/crm/prospects";
import { PERIODS, STALE_DAYS, daysSinceTouch, isPeriodKey, isProposalStage, isStale, summarizePipeline, type PeriodKey } from "@/lib/crm/metrics";
import { whatsappQuickAction } from "@/lib/crm/quick-actions";
import type { DealView } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

/** Fora do componente: a regra de pureza do React não permite Date.now() no render. */
function isOverdue(task: { status: string; dueAt: string | null }) {
  return task.status === "todo" && Boolean(task.dueAt) && Date.parse(String(task.dueAt)) < Date.now();
}

function nowMs() {
  return Date.now();
}

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const PAGE_SIZE = 25;

/** Próxima atividade: o que vier primeiro entre próximo contato e prazo de tarefa aberta. */
function nextActivity(deal: DealView) {
  const values = [deal.nextContactAt, deal.nextTaskDueAt].filter(Boolean).map((value) => String(value)).sort();
  return values[0] ?? "9999";
}

const SORTS = {
  atualizacao: { label: "Última atualização", compare: (a: DealView, b: DealView) => b.updatedAt.localeCompare(a.updatedAt) },
  criacao: { label: "Entrada no CRM", compare: (a: DealView, b: DealView) => b.createdAt.localeCompare(a.createdAt) },
  proxima: { label: "Próxima atividade", compare: (a: DealView, b: DealView) => nextActivity(a).localeCompare(nextActivity(b)) },
  valor: { label: "Valor", compare: (a: DealView, b: DealView) => (b.amountCents ?? -1) - (a.amountCents ?? -1) },
  empresa: { label: "Empresa", compare: (a: DealView, b: DealView) => a.company.companyName.localeCompare(b.company.companyName, "pt-BR") },
  fechamento: { label: "Previsão de fechamento", compare: (a: DealView, b: DealView) => (a.expectedCloseDate ?? "9999").localeCompare(b.expectedCloseDate ?? "9999") }
} as const;

/** Chaves antigas (links salvos) continuam funcionando. */
const SORT_ALIASES: Record<string, keyof typeof SORTS> = { recentes: "atualizacao", contato: "proxima" };

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

/** Data YYYY-MM-DD real (2026-02-30 e 2026-99-99 são descartadas). */
function validDate(value: string) {
  if (!DATE_PARAM.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

function param(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function targetLabel(deal: DealView) {
  return deal.company.kind === "prospect" ? (deal.company.personKind === "person" ? "Pessoa física" : "Cadastro manual") : formatCnpj(deal.company.cnpj);
}

export default async function CrmPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const view = param(params, "view") === "tabela" ? "tabela" : param(params, "view") === "tarefas" ? "tarefas" : "kanban";
  const owner = param(params, "owner");
  const q = param(params, "q").slice(0, 80);
  const sourceParam = param(params, "source");
  const source = isDealSource(sourceParam) ? sourceParam : "";
  const originParam = param(params, "origin");
  const origin = isProspectOrigin(originParam) ? originParam : "";
  const targetParam = param(params, "tipo");
  const target = targetParam === "prospect" || targetParam === "establishment" ? targetParam : "";
  const rawSort = SORT_ALIASES[param(params, "sort")] ?? param(params, "sort");
  const sortKey = (rawSort in SORTS ? rawSort : "atualizacao") as keyof typeof SORTS;
  const stageParam = param(params, "etapa");
  const createdFrom = validDate(param(params, "de"));
  const createdTo = validDate(param(params, "ate"));
  // "situacao" (e não "status", que é a chave de feedback das ações) para o filtro sobreviver aos redirects.
  const archivedView = param(params, "situacao") === "arquivados";
  const staleOnly = param(params, "acomp") === "sem";
  const periodKey: PeriodKey = isPeriodKey(param(params, "periodo")) ? (param(params, "periodo") as PeriodKey) : "30";
  const requestedPage = Math.max(1, Math.floor(Number(param(params, "pagina")) || 1));

  const session = await getCrmSession().catch((error) => {
    console.error("[crm] indisponível", { message: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (session === undefined) return <CrmUnavailable />;
  if (!session) return null;
  const { ctx, workspaces } = session;

  const stages = await listStages(ctx);
  const stageId = stages.some((stage) => stage.id === stageParam) ? stageParam : "";
  const filters: DealFilters = {
    owner: owner || undefined,
    q,
    source,
    origin,
    target,
    stageId: stageId || undefined,
    createdFrom: createdFrom || null,
    createdTo: createdTo || null,
    archived: archivedView ? "archived" : "active"
  };
  const [members, allDeals, tasks] = await Promise.all([
    listMembers(ctx),
    listDeals(ctx, filters),
    view === "tarefas" ? listTasks(ctx, { openOnly: param(params, "todas") !== "1", assigneeId: owner === "me" ? ctx.profileId : undefined }) : Promise.resolve([])
  ]);
  const now = nowMs();
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const isOpenDeal = (deal: DealView) => (stageById.get(deal.stageId)?.kind ?? "open") === "open";
  // "Sem acompanhamento" vale para lista, Kanban e indicadores (o mesmo recorte em tudo).
  const deals = staleOnly ? allDeals.filter((deal) => isOpenDeal(deal) && isStale(deal, now)) : allDeals;
  const actor = { profileId: ctx.profileId, role: ctx.role };

  // Querystring atual (sem feedback): ações voltam para a MESMA tela (filtros, busca e página).
  const currentQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value && !["status", "error", "detail"].includes(key)) currentQuery.set(key, value);
  }
  const hrefWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(currentQuery);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const text = next.toString();
    return `/dashboard/crm${text ? `?${text}` : ""}`;
  };
  const baseReturn = `/dashboard/crm${view === "kanban" ? "" : `?view=${view}`}`;
  const feedback = readCrmFeedback(params);
  const hasFilters = Boolean(owner || q || source || origin || target || stageId || createdFrom || createdTo || archivedView || staleOnly);

  const header = <CrmHeader ctx={ctx} workspaces={workspaces} current={view} returnTo={baseReturn} feedback={feedback} />;
  const periodStart = now - PERIODS[periodKey] * 86_400_000;
  const summary = summarizePipeline(deals, stages, now, { periodStart });
  const metrics = (
    <section className="crm-dashboard" aria-labelledby="crm-dashboard-title">
      <div className="crm-dashboard-head">
        <h3 id="crm-dashboard-title" className="headline">Resumo comercial{hasFilters ? <span className="caption"> · com os filtros atuais</span> : null}</h3>
        <nav className="cluster crm-period" aria-label="Período dos novos leads">
          {(Object.keys(PERIODS) as PeriodKey[]).map((key) => (
            <Link key={key} href={hrefWith({ periodo: key === "30" ? null : key, pagina: null })} className={`pill${periodKey === key ? " pill-active" : ""}`} aria-current={periodKey === key ? "true" : undefined}>
              {key} dias
            </Link>
          ))}
        </nav>
      </div>
      <dl className="crm-metrics">
        <div title="Negócios em etapa aberta (sem arquivados)"><dt>Prospects ativos</dt><dd className="numeric">{summary.open}</dd></div>
        <div title={`Entraram no CRM nos últimos ${PERIODS[periodKey]} dias`}><dt>Novos · {PERIODS[periodKey]} dias</dt><dd className="numeric">{summary.newInPeriod}</dd></div>
        <div title="Abertos que já saíram da etapa de entrada (exceto propostas)"><dt>Em negociação</dt><dd className="numeric">{summary.inNegotiation}</dd></div>
        <div title="Abertos em etapa de proposta"><dt>Propostas pendentes</dt><dd className="numeric">{summary.proposalsPending}</dd></div>
        <div><dt>Ganhos</dt><dd className="numeric crm-metric-won">{summary.won}</dd></div>
        <div><dt>Perdidos</dt><dd className="numeric">{summary.lost}</dd></div>
        <div title="Soma do valor dos negócios abertos"><dt>Valor potencial</dt><dd className="numeric">{formatCents(summary.openValueCents) || "R$ 0,00"}</dd></div>
        <div title="Ganhos ÷ (ganhos + perdidos)"><dt>Conversão</dt><dd className="numeric">{summary.conversionRate !== null ? `${summary.conversionRate}%` : "—"}</dd></div>
      </dl>
      {summary.stale || summary.overdueContacts ? (
        <p className="footnote crm-dashboard-alerts">
          {summary.overdueContacts ? <span className="crm-overdue">{summary.overdueContacts} contato(s) atrasado(s)</span> : null}
          {summary.overdueContacts && summary.stale ? " · " : null}
          {summary.stale ? (
            staleOnly ? (
              <span>{summary.stale} sem acompanhamento há mais de {STALE_DAYS} dias</span>
            ) : (
              <Link className="text-link" href={hrefWith({ acomp: "sem", view: "tabela", pagina: null })}>{summary.stale} sem acompanhamento há mais de {STALE_DAYS} dias</Link>
            )
          ) : null}
        </p>
      ) : null}
    </section>
  );

  const moreFiltersOpen = Boolean(target || origin || createdFrom || createdTo || archivedView || staleOnly);
  const filterForm = (
    <form method="get" className="crm-filters" role="search" aria-label="Filtrar prospects">
      {view !== "kanban" ? <input type="hidden" name="view" value={view} /> : null}
      {periodKey !== "30" ? <input type="hidden" name="periodo" value={periodKey} /> : null}
      <label className="field crm-filter-q">
        <span className="field-label">Buscar</span>
        <input name="q" type="search" className="input" defaultValue={q} placeholder="Empresa, CNPJ, contato, telefone ou e-mail" />
      </label>
      <label className="field">
        <span className="field-label">Etapa</span>
        <select name="etapa" className="input" defaultValue={stageId}>
          <option value="">Todas</option>
          {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Responsável</span>
        <select name="owner" className="input" defaultValue={owner}>
          <option value="">Todos</option>
          <option value="me">Meus</option>
          <option value="none">Sem responsável</option>
          {members.filter((member) => member.profileId !== ctx.profileId).map((member) => <option key={member.profileId} value={member.profileId}>{member.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Origem</span>
        <select name="source" className="input" defaultValue={source}>
          <option value="">Todas</option>
          {Object.entries(SOURCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {view === "tabela" ? (
        <label className="field">
          <span className="field-label">Ordenar por</span>
          <select name="sort" className="input" defaultValue={sortKey}>
            {Object.entries(SORTS).map(([value, sort]) => <option key={value} value={value}>{sort.label}</option>)}
          </select>
        </label>
      ) : null}
      <details className="crm-filters-more" open={moreFiltersOpen || undefined}>
        <summary>Mais filtros{moreFiltersOpen ? " (ativos)" : ""}</summary>
        <div className="crm-filters-more-grid">
          <label className="field">
            <span className="field-label">Tipo</span>
            <select name="tipo" className="input" defaultValue={target}>
              <option value="">Todos</option>
              <option value="establishment">Empresas da base</option>
              <option value="prospect">Cadastros manuais</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Origem do cadastro manual</span>
            <select name="origin" className="input" defaultValue={origin}>
              <option value="">Todas</option>
              {Object.entries(PROSPECT_ORIGIN_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Entrou no CRM de</span>
            <input type="date" name="de" className="input" defaultValue={createdFrom} />
          </label>
          <label className="field">
            <span className="field-label">Até</span>
            <input type="date" name="ate" className="input" defaultValue={createdTo} />
          </label>
          <label className="field">
            <span className="field-label">Situação</span>
            <select name="situacao" className="input" defaultValue={archivedView ? "arquivados" : ""}>
              <option value="">Ativos</option>
              <option value="arquivados">Arquivados</option>
            </select>
          </label>
          <label className="checkbox-inline crm-filter-check">
            <input type="checkbox" name="acomp" value="sem" defaultChecked={staleOnly} />
            <span>Só sem acompanhamento há {STALE_DAYS}+ dias</span>
          </label>
        </div>
      </details>
      <div className="cluster crm-filter-actions">
        <button type="submit" className="button-secondary button-sm">Filtrar</button>
        {hasFilters ? <Link href={baseReturn} className="button-ghost button-sm">Limpar filtros</Link> : null}
      </div>
    </form>
  );

  if (allDeals.length === 0 && !hasFilters && view !== "tarefas") {
    return (
      <>
        {header}
        <EmptyState
          title="Seu CRM está vazio"
          description="Cadastre um prospect manualmente (indicação, evento, WhatsApp…) ou envie empresas da busca por CNAE, do mapa empresarial, da ficha ou dos seus leads salvos."
          ctaHref="/dashboard/crm/novo"
          ctaLabel="Cadastrar o primeiro prospect"
        />
      </>
    );
  }

  if (view === "tarefas") {
    const dealById = new Map(allDeals.map((deal) => [deal.id, deal]));
    return (
      <>
        {header}
        <section className="section" aria-labelledby="crm-tasks-title">
          <div className="section-header-row">
            <div className="section-header">
              <h3 id="crm-tasks-title" className="title-2">{param(params, "todas") === "1" ? "Todas as tarefas" : "Tarefas em aberto"}</h3>
              <p className="footnote">Ordenadas pelo prazo. Tarefas vencidas aparecem em destaque.</p>
            </div>
            <div className="cluster">
              <Link className={`pill${owner === "me" ? "" : " pill-active"}`} href="/dashboard/crm?view=tarefas">Da equipe</Link>
              <Link className={`pill${owner === "me" ? " pill-active" : ""}`} href="/dashboard/crm?view=tarefas&owner=me">Minhas</Link>
              <Link className="pill" href={`/dashboard/crm?view=tarefas${owner === "me" ? "&owner=me" : ""}${param(params, "todas") === "1" ? "" : "&todas=1"}`}>{param(params, "todas") === "1" ? "Só abertas" : "Incluir concluídas"}</Link>
            </div>
          </div>
          {tasks.length === 0 ? <div className="notice info">Nenhuma tarefa por aqui.</div> : (
            <ul className="crm-task-list">
              {tasks.map((task) => {
                const deal = dealById.get(task.dealId);
                const overdue = isOverdue(task);
                const editable = deal ? canUpdateTask(actor, task, deal) : false;
                return (
                  <li key={task.id} className={`crm-task${task.status === "done" ? " is-done" : ""}`}>
                    <form action={toggleTaskAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="done" value={task.status === "done" ? "0" : "1"} />
                      <input type="hidden" name="returnTo" value={`/dashboard/crm?view=tarefas${owner === "me" ? "&owner=me" : ""}`} />
                      <button type="submit" className="crm-task-check" disabled={!editable} aria-label={task.status === "done" ? `Reabrir ${task.title}` : `Concluir ${task.title}`} aria-pressed={task.status === "done"} />
                    </form>
                    <div className="crm-task-body">
                      <strong>{task.title}</strong>
                      <span className="footnote">
                        {deal ? <Link href={`/dashboard/crm/${deal.id}`} className="text-link">{deal.company.companyName}</Link> : "Negócio"}
                        {" · "}{task.assigneeName ?? "Sem responsável"}
                      </span>
                    </div>
                    <span className={`pill${overdue ? " danger" : task.status === "done" ? " success" : ""}`}>{task.status === "done" ? "Concluída" : task.dueAt ? formatDateTime(task.dueAt) : "Sem prazo"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </>
    );
  }

  if (view === "tabela") {
    const sorted = [...deals].sort(SORTS[sortKey].compare);
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    // Página além do fim (ex.: após excluir os últimos itens) cai na última página válida.
    const page = Math.min(requestedPage, pageCount);
    const pageDeals = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const returnTo = hrefWith({ pagina: page > 1 ? String(page) : null });
    const rows: ProspectRow[] = pageDeals.map((deal) => {
      const stage = stageById.get(deal.stageId);
      const whatsapp = whatsappQuickAction(deal.contactPhone, deal.company.whatsappPhone);
      const open = (stage?.kind ?? "open") === "open";
      return {
        id: deal.id,
        href: `/dashboard/crm/${deal.id}`,
        editHref: deal.prospectId ? `/dashboard/crm/${deal.id}/editar` : `/dashboard/crm/${deal.id}#details-title`,
        name: deal.company.tradeName || deal.company.companyName,
        subtitle: [targetLabel(deal), [deal.company.cityName, deal.company.stateCode].filter(Boolean).join("/")].filter(Boolean).join(" · "),
        isManual: Boolean(deal.prospectId),
        stageId: deal.stageId,
        stageKind: stage?.kind ?? "open",
        ownerName: deal.ownerName,
        amountLabel: deal.amountCents !== null ? formatCents(deal.amountCents) : null,
        nextContactLabel: deal.nextContactAt ? formatDateTime(deal.nextContactAt) : null,
        nextContactOverdue: open && Boolean(deal.nextContactAt) && Date.parse(String(deal.nextContactAt)) < now,
        openTasks: deal.openTasks,
        proposalPending: open && isProposalStage(stage),
        lastInteractionLabel: deal.lastInteractionAt ? formatDateTime(deal.lastInteractionAt) : null,
        daysSinceTouch: daysSinceTouch(deal, now),
        stale: open && !deal.archivedAt && isStale(deal, now),
        sourceLabel: deal.prospectId ? "Cadastro manual" : SOURCE_LABEL[deal.source],
        archived: Boolean(deal.archivedAt),
        canEdit: canEditDeal(actor, deal),
        canDelete: canDeleteDeal(actor, deal),
        whatsappUrl: whatsapp.url,
        whatsappDisplay: whatsapp.display,
        whatsappProblem: whatsapp.problem,
        phone: deal.contactPhone,
        email: deal.contactEmail,
        contactName: deal.contactName,
        updatedLabel: formatDateTime(deal.updatedAt)
      };
    });
    const first = sorted.length ? (page - 1) * PAGE_SIZE + 1 : 0;
    const last = Math.min(page * PAGE_SIZE, sorted.length);
    return (
      <>
        {header}
        {metrics}
        {filterForm}
        <section className="section" aria-labelledby="crm-table-title">
          <div className="crm-list-head">
            <h3 id="crm-table-title" className="headline">{archivedView ? "Prospects arquivados" : "Prospects"}</h3>
            <p className="footnote" aria-live="polite">
              {sorted.length ? `${first}–${last} de ${sorted.length}` : "Nenhum resultado"} · total {formatCents(deals.reduce((sum, deal) => sum + (deal.amountCents ?? 0), 0)) || "R$ 0,00"}
            </p>
          </div>
          {sorted.length === 0 ? (
            <div className="notice info">
              {archivedView ? "Nenhum prospect arquivado." : "Nenhum prospect corresponde aos filtros."}{" "}
              {hasFilters ? <Link href={baseReturn} className="text-link">Limpar filtros</Link> : null}
            </div>
          ) : (
            <ProspectList rows={rows} stages={stages} returnTo={returnTo} archivedView={archivedView} />
          )}
          {pageCount > 1 ? (
            <nav className="cluster crm-pagination" aria-label="Paginação dos prospects">
              {page > 1 ? <Link className="button-secondary button-sm" href={hrefWith({ pagina: page - 1 > 1 ? String(page - 1) : null })} rel="prev">Anterior</Link> : <span className="button-secondary button-sm" aria-disabled="true">Anterior</span>}
              <span className="footnote" aria-current="page">Página {page} de {pageCount}</span>
              {page < pageCount ? <Link className="button-secondary button-sm" href={hrefWith({ pagina: String(page + 1) })} rel="next">Próxima</Link> : <span className="button-secondary button-sm" aria-disabled="true">Próxima</span>}
            </nav>
          ) : null}
        </section>
      </>
    );
  }

  const boardDeals: BoardDeal[] = deals.map((deal) => ({
    id: deal.id,
    stageId: deal.stageId,
    position: deal.position,
    href: `/dashboard/crm/${deal.id}`,
    companyName: deal.company.tradeName || deal.company.companyName,
    subtitle: [deal.company.cityName && `${deal.company.cityName}${deal.company.stateCode ? `/${deal.company.stateCode}` : ""}`, targetLabel(deal)].filter(Boolean).join(" · "),
    amountCents: deal.amountCents,
    ownerName: deal.ownerName,
    openTasks: deal.openTasks,
    nextTaskDueAt: deal.nextTaskDueAt,
    sourceLabel: deal.prospectId ? "Manual" : SOURCE_LABEL[deal.source],
    canMove: canMoveDeal(actor, deal),
    whatsappPhone: deal.company.whatsappPhone,
    nextContactAt: deal.nextContactAt,
    highPriority: deal.priority === "high",
    isManual: Boolean(deal.prospectId)
  }));

  return (
    <>
      {header}
      {metrics}
      {filterForm}
      <section className="section crm-board-section" aria-labelledby="crm-board-title">
        <div className="cluster cluster-between">
          <h3 id="crm-board-title" className="sr-only">Pipeline em Kanban</h3>
          <p className="footnote">
            {deals.length} negócio(s){archivedView ? " arquivado(s)" : ""} · arraste o card (ou a alça ⠿ no celular) ou use o seletor “Mover para” do card (teclado).
          </p>
        </div>
        <KanbanBoard stages={stages} deals={boardDeals} moveAction={moveDealAction} />
      </section>
    </>
  );
}
