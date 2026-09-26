import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmHeader } from "@/components/crm/crm-header";
import { CrmUnavailable } from "@/components/crm/crm-unavailable";
import { CrmTimeline } from "@/components/crm/crm-timeline";
import {
  addContactAction,
  addNoteAction,
  addTaskAction,
  deleteContactAction,
  deleteDealAction,
  toggleTaskAction,
  updateDealAction
} from "@/app/dashboard/crm/actions";
import { formatCnpj, formatDateTime } from "@/lib/format";
import { formatCents, isUuid } from "@/lib/crm/input";
import { readCrmFeedback } from "@/lib/crm/messages";
import { canAssignDeal, canDeleteDeal, canEditDeal, canUpdateTask } from "@/lib/crm/permissions";
import { getDeal, listActivities, listContacts, listMembers, listNotes, listStages, listTasks } from "@/lib/crm/repository";
import { getCrmSession } from "@/lib/crm/server";
import { SOURCE_LABEL, buildTimeline } from "@/lib/crm/timeline";

export const dynamic = "force-dynamic";

/** Fora do componente: a regra de pureza do React não permite Date.now() no render. */
function isOverdue(task: { status: string; dueAt: string | null }) {
  return task.status === "todo" && Boolean(task.dueAt) && Date.parse(String(task.dueAt)) < Date.now();
}

type PageProps = {
  params: Promise<{ dealId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DealPage({ params, searchParams }: PageProps) {
  const { dealId } = await params;
  const query = searchParams ? await searchParams : {};
  if (!isUuid(dealId)) notFound();

  const session = await getCrmSession().catch(() => undefined);
  if (session === undefined) return <CrmUnavailable />;
  if (!session) return null;
  const { ctx, workspaces } = session;

  // Escopo do workspace: um id de outro workspace simplesmente não é encontrado.
  const deal = await getDeal(ctx, dealId);
  if (!deal) notFound();

  const [stages, members, notes, tasks, contacts, activities] = await Promise.all([
    listStages(ctx),
    listMembers(ctx),
    listNotes(ctx, deal.id),
    listTasks(ctx, { dealId: deal.id }),
    listContacts(ctx, deal.establishmentId),
    listActivities(ctx, { dealId: deal.id })
  ]);
  const actor = { profileId: ctx.profileId, role: ctx.role };
  const memberIds = new Set(members.map((member) => member.profileId));
  const editable = canEditDeal(actor, deal);
  const assignOptions = members.filter((member) => member.profileId === deal.ownerProfileId || canAssignDeal(actor, deal, member.profileId, memberIds));
  const canUnassign = deal.ownerProfileId !== null && canAssignDeal(actor, deal, null, memberIds);
  const canChangeOwner = assignOptions.some((member) => member.profileId !== deal.ownerProfileId) || canUnassign;
  const stage = stages.find((item) => item.id === deal.stageId);
  const primary = contacts.find((contact) => contact.id === deal.primaryContactId) ?? null;
  const timeline = buildTimeline(activities, notes);
  const self = `/dashboard/crm/${deal.id}`;
  const feedback = readCrmFeedback(query);

  return (
    <>
      <CrmHeader ctx={ctx} workspaces={workspaces} current="negocio" returnTo="/dashboard/crm" feedback={feedback} />

      <section className="crm-deal-hero" aria-labelledby="deal-title">
        <Link href="/dashboard/crm" className="button-ghost button-sm">← Pipeline</Link>
        <div className="section-header">
          <span className="eyebrow">Negócio · {SOURCE_LABEL[deal.source]}</span>
          <h2 id="deal-title" className="title-1">{deal.company.companyName}</h2>
          <p className="footnote numeric">
            {formatCnpj(deal.company.cnpj)}
            {deal.company.tradeName ? ` · ${deal.company.tradeName}` : ""}
            {deal.company.cityName ? ` · ${deal.company.cityName}/${deal.company.stateCode}` : ""}
          </p>
          <div className="inline-list">
            <span className={`pill${stage?.kind === "won" ? " success" : stage?.kind === "lost" ? " danger" : " accent"}`}>{stage?.name ?? "Sem etapa"}</span>
            <span className="pill">{deal.ownerName ? `Responsável: ${deal.ownerName}` : "Sem responsável"}</span>
            {deal.amountCents !== null ? <span className="pill numeric">{formatCents(deal.amountCents)}</span> : null}
            <Link href={`/dashboard/companies/${encodeURIComponent(deal.company.cnpj)}`} className="pill">Ficha da empresa →</Link>
          </div>
          <p className="footnote">Dados cadastrais exibidos da base oficial (establishments). O CRM guarda apenas a referência à empresa.</p>
        </div>
      </section>

      <div className="crm-deal-grid">
        <div className="stack-lg crm-deal-main">
          <section className="tile tile-compact stack-sm" aria-labelledby="note-title">
            <h3 id="note-title" className="headline">Nova nota</h3>
            <form action={addNoteAction} className="stack-xs">
              <input type="hidden" name="dealId" value={deal.id} />
              <label className="sr-only" htmlFor="note-body">Texto da nota</label>
              <textarea id="note-body" name="body" className="textarea" rows={3} maxLength={5000} required placeholder="Resumo da ligação, objeções, próximos passos…" />
              <div className="cluster cluster-end"><button type="submit" className="button-secondary button-sm">Registrar nota</button></div>
            </form>
          </section>

          <section className="stack-sm" aria-labelledby="timeline-title">
            <h3 id="timeline-title" className="title-3">Histórico</h3>
            <CrmTimeline groups={timeline} />
          </section>
        </div>

        <aside className="stack-lg crm-deal-side" aria-label="Detalhes do negócio">
          <section className="card stack-sm" aria-labelledby="details-title">
            <h3 id="details-title" className="headline">Detalhes</h3>
            <form action={updateDealAction} className="stack-xs">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="returnTo" value={self} />
              <fieldset className="stack-xs crm-fieldset" disabled={!editable}>
                <label className="field"><span className="field-label">Etapa</span>
                  <select name="stageId" className="input" defaultValue={deal.stageId}>
                    {stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
                <label className="field"><span className="field-label">Título (opcional)</span>
                  <input name="title" className="input" defaultValue={deal.title ?? ""} maxLength={160} placeholder="Ex.: Contrato anual de contabilidade" />
                </label>
                <div className="grid-2 crm-grid-tight">
                  <label className="field"><span className="field-label">Valor (R$)</span>
                    <input name="amount" className="input numeric" inputMode="decimal" defaultValue={deal.amountCents !== null ? (deal.amountCents / 100).toFixed(2).replace(".", ",") : ""} placeholder="0,00" />
                  </label>
                  <label className="field"><span className="field-label">Previsão</span>
                    <input name="expectedCloseDate" type="date" className="input" defaultValue={deal.expectedCloseDate ?? ""} />
                  </label>
                </div>
                {stage?.kind === "lost" ? (
                  <label className="field"><span className="field-label">Motivo da perda</span>
                    <input name="lostReason" className="input" defaultValue={deal.lostReason ?? ""} maxLength={500} />
                  </label>
                ) : null}
                <label className="field"><span className="field-label">Contato principal</span>
                  <select name="primaryContactId" className="input" defaultValue={deal.primaryContactId ?? ""}>
                    <option value="">Nenhum</option>
                    {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
                  </select>
                </label>
              </fieldset>
              {!editable ? <p className="footnote">Somente o responsável ou um administrador edita este negócio. Você ainda pode registrar notas e tarefas.</p> : <div className="cluster cluster-end"><button type="submit" className="button-secondary button-sm">Salvar detalhes</button></div>}
            </form>

            <form action={updateDealAction} className="stack-xs">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="returnTo" value={self} />
              <label className="field"><span className="field-label">Responsável</span>
                <select name="ownerProfileId" className="input" defaultValue={deal.ownerProfileId ?? ""} disabled={!canChangeOwner}>
                  {deal.ownerProfileId === null || canUnassign ? <option value="">Sem responsável</option> : null}
                  {assignOptions.map((member) => <option key={member.profileId} value={member.profileId}>{member.name}{member.profileId === ctx.profileId ? " (você)" : ""}</option>)}
                </select>
              </label>
              {canChangeOwner ? <div className="cluster cluster-end"><button type="submit" className="button-ghost button-sm">Atualizar responsável</button></div> : null}
            </form>
            <dl className="kv-list crm-kv">
              <div className="kv-row"><dt>Criado em</dt><dd>{formatDateTime(deal.createdAt)}</dd></div>
              <div className="kv-row"><dt>Atualizado em</dt><dd>{formatDateTime(deal.updatedAt)}</dd></div>
              {deal.closedAt ? <div className="kv-row"><dt>Fechado em</dt><dd>{formatDateTime(deal.closedAt)}</dd></div> : null}
              <div className="kv-row"><dt>Origem</dt><dd>{SOURCE_LABEL[deal.source]}</dd></div>
            </dl>
          </section>

          <section className="card stack-sm" aria-labelledby="tasks-title">
            <h3 id="tasks-title" className="headline">Tarefas</h3>
            {tasks.length ? (
              <ul className="crm-task-list is-compact">
                {tasks.map((task) => {
                  const overdue = isOverdue(task);
                  return (
                    <li key={task.id} className={`crm-task${task.status === "done" ? " is-done" : ""}`}>
                      <form action={toggleTaskAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="done" value={task.status === "done" ? "0" : "1"} />
                        <input type="hidden" name="returnTo" value={self} />
                        <button type="submit" className="crm-task-check" disabled={!canUpdateTask(actor, task, deal)} aria-pressed={task.status === "done"} aria-label={task.status === "done" ? `Reabrir ${task.title}` : `Concluir ${task.title}`} />
                      </form>
                      <div className="crm-task-body">
                        <strong>{task.title}</strong>
                        <span className={`footnote${overdue ? " crm-overdue" : ""}`}>{task.dueAt ? formatDateTime(task.dueAt) : "Sem prazo"} · {task.assigneeName ?? "Sem responsável"}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="footnote">Nenhuma tarefa.</p>}
            <form action={addTaskAction} className="stack-xs crm-subform">
              <input type="hidden" name="dealId" value={deal.id} />
              <label className="field"><span className="field-label">Nova tarefa</span><input name="title" className="input" required maxLength={200} placeholder="Ligar para agendar reunião" /></label>
              <div className="grid-2 crm-grid-tight">
                <label className="field"><span className="field-label">Prazo</span><input name="dueAt" type="datetime-local" className="input" /></label>
                <label className="field"><span className="field-label">Para</span>
                  <select name="assigneeProfileId" className="input" defaultValue={ctx.profileId}>
                    {members.map((member) => <option key={member.profileId} value={member.profileId}>{member.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="cluster cluster-end"><button type="submit" className="button-secondary button-sm">Criar tarefa</button></div>
            </form>
          </section>

          <section className="card stack-sm" aria-labelledby="contacts-title">
            <h3 id="contacts-title" className="headline">Contatos</h3>
            <p className="footnote">Pessoas cadastradas por você neste workspace (dado pessoal: registre só o necessário).</p>
            {contacts.length ? (
              <ul className="crm-contact-list">
                {contacts.map((contact) => (
                  <li key={contact.id} className="crm-contact">
                    <div className="stack-2xs">
                      <strong>{contact.name}{primary?.id === contact.id ? <span className="pill accent crm-pill-inline">Principal</span> : null}</strong>
                      <span className="footnote">{[contact.jobTitle, contact.email, contact.phone].filter(Boolean).join(" · ") || "Sem dados de contato"}</span>
                    </div>
                    {editable ? (
                      <form action={deleteContactAction}>
                        <input type="hidden" name="dealId" value={deal.id} />
                        <input type="hidden" name="contactId" value={contact.id} />
                        <button type="submit" className="button-ghost button-sm is-destructive" aria-label={`Excluir contato ${contact.name}`}>Excluir</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <details className="crm-disclosure">
              <summary>Adicionar contato</summary>
              <form action={addContactAction} className="stack-xs crm-subform">
                <input type="hidden" name="dealId" value={deal.id} />
                <label className="field"><span className="field-label">Nome</span><input name="name" className="input" required maxLength={120} autoComplete="off" /></label>
                <label className="field"><span className="field-label">Cargo</span><input name="jobTitle" className="input" maxLength={120} autoComplete="off" /></label>
                <div className="grid-2 crm-grid-tight">
                  <label className="field"><span className="field-label">E-mail</span><input name="email" type="email" className="input" autoComplete="off" /></label>
                  <label className="field"><span className="field-label">Telefone</span><input name="phone" type="tel" className="input" autoComplete="off" /></label>
                </div>
                {editable ? <label className="checkbox-inline"><input type="checkbox" name="makePrimary" value="1" /> Definir como contato principal</label> : null}
                <div className="cluster cluster-end"><button type="submit" className="button-secondary button-sm">Salvar contato</button></div>
              </form>
            </details>
          </section>

          {canDeleteDeal(actor, deal) ? (
            <form action={deleteDealAction} className="crm-danger-zone">
              <input type="hidden" name="dealId" value={deal.id} />
              <button type="submit" className="button-ghost button-sm is-destructive">Remover do CRM</button>
              <p className="footnote">Apaga notas, tarefas e o negócio. A empresa, as listas e os contatos permanecem.</p>
            </form>
          ) : null}
        </aside>
      </div>
    </>
  );
}
