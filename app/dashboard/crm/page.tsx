import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { CrmHeader } from "@/components/crm/crm-header";
import { KanbanBoard, type BoardDeal } from "@/components/crm/kanban-board";
import { CrmUnavailable } from "@/components/crm/crm-unavailable";
import { moveDealAction, moveDealFormAction, toggleTaskAction } from "@/app/dashboard/crm/actions";
import { formatCnpj, formatDate, formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/crm/input";
import { readCrmFeedback } from "@/lib/crm/messages";
import { canMoveDeal, canUpdateTask } from "@/lib/crm/permissions";
import { listDeals, listMembers, listStages, listTasks, type DealFilters } from "@/lib/crm/repository";
import { getCrmSession } from "@/lib/crm/server";
import { SOURCE_LABEL, isDealSource } from "@/lib/crm/timeline";
import type { DealView } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

/** Fora do componente: a regra de pureza do React não permite Date.now() no render. */
function isOverdue(task: { status: string; dueAt: string | null }) {
  return task.status === "todo" && Boolean(task.dueAt) && Date.parse(String(task.dueAt)) < Date.now();
}

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const SORTS = {
  recentes: { label: "Atualização", compare: (a: DealView, b: DealView) => b.updatedAt.localeCompare(a.updatedAt) },
  valor: { label: "Valor", compare: (a: DealView, b: DealView) => (b.amountCents ?? -1) - (a.amountCents ?? -1) },
  empresa: { label: "Empresa", compare: (a: DealView, b: DealView) => a.company.companyName.localeCompare(b.company.companyName, "pt-BR") },
  fechamento: { label: "Previsão", compare: (a: DealView, b: DealView) => (a.expectedCloseDate ?? "9999").localeCompare(b.expectedCloseDate ?? "9999") }
} as const;

function param(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

export default async function CrmPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const view = param(params, "view") === "tabela" ? "tabela" : param(params, "view") === "tarefas" ? "tarefas" : "kanban";
  const owner = param(params, "owner");
  const q = param(params, "q").slice(0, 80);
  const sourceParam = param(params, "source");
  const source = isDealSource(sourceParam) ? sourceParam : "";
  const sortKey = (param(params, "sort") in SORTS ? param(params, "sort") : "recentes") as keyof typeof SORTS;

  const session = await getCrmSession().catch((error) => {
    console.error("[crm] indisponível", { message: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (session === undefined) return <CrmUnavailable />;
  if (!session) return null;
  const { ctx, workspaces } = session;

  const filters: DealFilters = { owner: owner || undefined, q, source };
  const [stages, members, deals, tasks] = await Promise.all([
    listStages(ctx),
    listMembers(ctx),
    listDeals(ctx, filters),
    view === "tarefas" ? listTasks(ctx, { openOnly: param(params, "todas") !== "1", assigneeId: owner === "me" ? ctx.profileId : undefined }) : Promise.resolve([])
  ]);
  const actor = { profileId: ctx.profileId, role: ctx.role };
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const returnTo = `/dashboard/crm${view === "kanban" ? "" : `?view=${view}`}`;
  const feedback = readCrmFeedback(params);
  const hasFilters = Boolean(owner || q || source);

  const header = <CrmHeader ctx={ctx} workspaces={workspaces} current={view} returnTo={returnTo} feedback={feedback} />;

  const filterForm = (
    <form method="get" className="crm-filters" role="search" aria-label="Filtrar negócios">
      {view !== "kanban" ? <input type="hidden" name="view" value={view} /> : null}
      <label className="field crm-filter-q">
        <span className="field-label">Buscar</span>
        <input name="q" className="input" defaultValue={q} placeholder="Empresa, CNPJ, cidade ou título" />
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
      <div className="cluster crm-filter-actions">
        <button type="submit" className="button-secondary button-sm">Filtrar</button>
        {hasFilters ? <Link href={returnTo} className="button-ghost button-sm">Limpar</Link> : null}
      </div>
    </form>
  );

  if (deals.length === 0 && !hasFilters && view !== "tarefas") {
    return (
      <>
        {header}
        <EmptyState
          title="Seu CRM está vazio"
          description="Adicione empresas pela ficha, pela seleção na tabela de resultados ou enviando uma lista de prospecção inteira. O CRM referencia a empresa da base — nada é copiado."
          ctaHref="/dashboard/leads"
          ctaLabel="Enviar uma lista ao CRM"
        />
      </>
    );
  }

  if (view === "tarefas") {
    const dealById = new Map(deals.map((deal) => [deal.id, deal]));
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
    return (
      <>
        {header}
        {filterForm}
        <section className="section" aria-labelledby="crm-table-title">
          <h3 id="crm-table-title" className="sr-only">Negócios em tabela</h3>
          <p className="footnote">{deals.length} negócio(s) · total {formatCents(deals.reduce((sum, deal) => sum + (deal.amountCents ?? 0), 0)) || "R$ 0,00"}</p>
          {sorted.length === 0 ? <div className="notice info">Nenhum negócio corresponde aos filtros.</div> : (
            <div className="table-wrap">
              <table className="table table-responsive crm-table">
                <caption className="sr-only">Negócios do CRM</caption>
                <thead>
                  <tr><th>Empresa</th><th>Etapa</th><th>Responsável</th><th className="cell-num">Valor</th><th>Previsão</th><th>Tarefas</th><th>Origem</th><th>Atualizado</th></tr>
                </thead>
                <tbody>
                  {sorted.map((deal) => {
                    const stage = stageById.get(deal.stageId);
                    return (
                      <tr key={deal.id}>
                        <td data-label="Empresa">
                          <div className="cell-stack">
                            <Link href={`/dashboard/crm/${deal.id}`} className="cell-strong text-link">{deal.company.companyName}</Link>
                            <span className="muted">{formatCnpj(deal.company.cnpj)} · {[deal.company.cityName, deal.company.stateCode].filter(Boolean).join("/") || "—"}</span>
                          </div>
                        </td>
                        <td data-label="Etapa">
                          {canMoveDeal(actor, deal) ? (
                            <form action={moveDealFormAction} className="crm-inline-stage">
                              <input type="hidden" name="dealId" value={deal.id} />
                              <input type="hidden" name="returnTo" value={`/dashboard/crm?view=tabela`} />
                              <select name="stageId" className="input" defaultValue={deal.stageId} aria-label={`Etapa de ${deal.company.companyName}`}>
                                {stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                              </select>
                              <button type="submit" className="button-ghost button-sm">Mover</button>
                            </form>
                          ) : (
                            <span className={`pill${stage?.kind === "won" ? " success" : stage?.kind === "lost" ? " danger" : ""}`}>{stage?.name ?? "—"}</span>
                          )}
                        </td>
                        <td data-label="Responsável">{deal.ownerName ?? <span className="muted">Sem responsável</span>}</td>
                        <td data-label="Valor" className="cell-num">{deal.amountCents !== null ? formatCents(deal.amountCents) : "—"}</td>
                        <td data-label="Previsão">{deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "—"}</td>
                        <td data-label="Tarefas">{deal.openTasks ? `${deal.openTasks} aberta(s)` : "—"}</td>
                        <td data-label="Origem"><span className="pill">{SOURCE_LABEL[deal.source]}</span></td>
                        <td data-label="Atualizado" className="cell-nowrap">{formatDateTime(deal.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
    subtitle: [deal.company.cityName && `${deal.company.cityName}/${deal.company.stateCode}`, formatCnpj(deal.company.cnpj)].filter(Boolean).join(" · "),
    amountCents: deal.amountCents,
    ownerName: deal.ownerName,
    openTasks: deal.openTasks,
    nextTaskDueAt: deal.nextTaskDueAt,
    sourceLabel: SOURCE_LABEL[deal.source],
    canMove: canMoveDeal(actor, deal)
  }));

  return (
    <>
      {header}
      {filterForm}
      <section className="section crm-board-section" aria-labelledby="crm-board-title">
        <div className="cluster cluster-between">
          <h3 id="crm-board-title" className="sr-only">Pipeline em Kanban</h3>
          <p className="footnote">
            {deals.length} negócio(s) · arraste o card (ou a alça ⠿ no celular) ou use o seletor de etapa do card.
          </p>
        </div>
        <KanbanBoard stages={stages} deals={boardDeals} moveAction={moveDealAction} />
      </section>
    </>
  );
}
