import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmHeader } from "@/components/crm/crm-header";
import { CrmUnavailable } from "@/components/crm/crm-unavailable";
import { CrmTimeline } from "@/components/crm/crm-timeline";
import { WhatsAppComposer, type ComposerRecipient } from "@/components/crm/whatsapp-composer";
import { WhatsAppLink } from "@/components/crm/whatsapp-link";
import {
  addContactAction,
  addNoteAction,
  addTaskAction,
  deleteContactAction,
  deleteDealAction,
  toggleTaskAction,
  updateDealAction
} from "@/app/dashboard/crm/actions";
import { logInteractionAction, logWhatsappContact, scheduleNextContactAction } from "@/app/dashboard/crm/prospect-actions";
import { formatCnpj, formatDateTime } from "@/lib/format";
import { formatCents, isUuid } from "@/lib/crm/input";
import { readCrmFeedback } from "@/lib/crm/messages";
import { canAssignDeal, canDeleteDeal, canEditDeal, canUpdateTask } from "@/lib/crm/permissions";
import { PRIORITY_LABEL, PROSPECT_ORIGIN_LABEL, formatCpf } from "@/lib/crm/prospects";
import { getDeal, getProspect, listActivities, listContacts, listMembers, listNotes, listStages, listTasks, listTemplates } from "@/lib/crm/repository";
import { getCrmSession } from "@/lib/crm/server";
import { INTERACTION_LABEL, INTERACTION_OUTCOME_LABEL, SOURCE_LABEL, buildTimeline } from "@/lib/crm/timeline";

export const dynamic = "force-dynamic";

/** Fora do componente: a regra de pureza do React não permite Date.now() no render. */
function isOverdue(task: { status: string; dueAt: string | null }) {
  return task.status === "todo" && Boolean(task.dueAt) && Date.parse(String(task.dueAt)) < Date.now();
}

function isPast(value: string | null) {
  return Boolean(value) && Date.parse(String(value)) < Date.now();
}

/** ISO → valor de <input type="datetime-local"> no fuso de São Paulo. */
function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
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

  const [stages, members, notes, tasks, contacts, activities, prospect, templates] = await Promise.all([
    listStages(ctx),
    listMembers(ctx),
    listNotes(ctx, deal.id),
    listTasks(ctx, { dealId: deal.id }),
    listContacts(ctx, deal),
    listActivities(ctx, { dealId: deal.id }),
    deal.prospectId ? getProspect(ctx, deal.prospectId) : Promise.resolve(null),
    listTemplates(ctx)
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
  const isProspect = deal.company.kind === "prospect";
  const isPerson = prospect?.kind === "person";
  const displayName = deal.company.tradeName || deal.company.companyName;
  const me = members.find((member) => member.profileId === ctx.profileId);

  // Destinatários do WhatsApp: telefones do prospect (ou o público da ficha) + contatos.
  const recipients: ComposerRecipient[] = [];
  if (prospect) {
    // Primeiro nome na saudação ("Olá, José!"), como nos contatos.
    const contactName = (isPerson ? prospect.name : prospect.contactName)?.split(" ")[0] ?? null;
    if (prospect.whatsapp) recipients.push({ id: "p-wa", label: `WhatsApp${prospect.contactName ? ` · ${prospect.contactName}` : ""}`, phone: prospect.whatsapp, contactName });
    if (prospect.phone) recipients.push({ id: "p-phone", label: "Telefone principal", phone: prospect.phone, contactName });
    if (prospect.phoneSecondary) recipients.push({ id: "p-phone2", label: "Telefone adicional", phone: prospect.phoneSecondary, contactName });
  } else if (deal.company.whatsappPhone) {
    recipients.push({ id: "e-phone", label: "Telefone da ficha (dado público)", phone: deal.company.whatsappPhone, contactName: null });
  }
  for (const contact of contacts) {
    const phone = contact.whatsapp || contact.phone;
    if (phone) recipients.push({ id: `c-${contact.id}`, label: `${contact.name}${contact.jobTitle ? ` (${contact.jobTitle})` : ""}`, phone, contactName: contact.name.split(" ")[0] });
  }
  const templateValues = {
    nome_empresa: isPerson ? null : displayName,
    nome_usuario: me?.name ?? null,
    cidade: deal.company.cityName || null
  };
  const nowLocal = toLocalInput(new Date().toISOString());

  return (
    <>
      <CrmHeader ctx={ctx} workspaces={workspaces} current="negocio" returnTo="/dashboard/crm" feedback={feedback} />

      <section className="crm-deal-hero" aria-labelledby="deal-title">
        <Link href="/dashboard/crm" className="button-ghost button-sm">← Pipeline</Link>
        <div className="section-header">
          <span className="eyebrow">
            {isProspect ? (isPerson ? "Pessoa física" : "Empresa") : "Empresa da base"} · {isProspect && prospect ? PROSPECT_ORIGIN_LABEL[prospect.origin] : SOURCE_LABEL[deal.source]}
          </span>
          <h2 id="deal-title" className="title-1">{deal.company.companyName}</h2>
          <p className="footnote numeric">
            {[
              deal.company.cnpj ? formatCnpj(deal.company.cnpj) : prospect?.documentType === "cnpj" && prospect.document ? formatCnpj(prospect.document) : null,
              deal.company.tradeName || null,
              deal.company.cityName ? `${deal.company.cityName}${deal.company.stateCode ? `/${deal.company.stateCode}` : ""}` : null
            ].filter(Boolean).join(" · ")}
          </p>
          <div className="inline-list">
            <span className={`pill${stage?.kind === "won" ? " success" : stage?.kind === "lost" ? " danger" : " accent"}`}>{stage?.name ?? "Sem etapa"}</span>
            <span className="pill">{deal.ownerName ? `Responsável: ${deal.ownerName}` : "Sem responsável"}</span>
            {deal.priority !== "normal" ? <span className={`pill${deal.priority === "high" ? " warning" : ""}`}>Prioridade {PRIORITY_LABEL[deal.priority].toLowerCase()}</span> : null}
            {deal.amountCents !== null ? <span className="pill numeric">{formatCents(deal.amountCents)}</span> : null}
            {deal.nextContactAt ? <span className={`pill${isPast(deal.nextContactAt) ? " danger" : ""}`}>Próximo contato: {formatDateTime(deal.nextContactAt)}</span> : null}
            {!isProspect ? <Link href={`/dashboard/companies/${encodeURIComponent(deal.company.cnpj)}`} className="pill">Ficha da empresa →</Link> : null}
          </div>
          <div className="cluster crm-hero-actions">
            <WhatsAppComposer dealId={deal.id} recipients={recipients} templates={templates} values={templateValues} logAction={logWhatsappContact} />
            {isProspect && editable ? <Link href={`${self}/editar`} className="button-ghost button-sm">Editar cadastro</Link> : null}
          </div>
          <p className="footnote">
            {isProspect
              ? "Cadastro manual: dados informados pelo usuário deste workspace, sem relação com a base oficial de CNPJ."
              : "Dados cadastrais exibidos da base oficial (establishments). O CRM guarda apenas a referência à empresa."}
          </p>
        </div>
      </section>

      <div className="crm-deal-grid">
        <div className="stack-lg crm-deal-main">
          <section className="tile tile-compact stack-sm" aria-labelledby="interaction-title">
            <h3 id="interaction-title" className="headline">Registrar contato</h3>
            <form action={logInteractionAction} className="stack-xs">
              <input type="hidden" name="dealId" value={deal.id} />
              <div className="grid-2 crm-grid-tight crm-interaction-grid">
                <label className="field"><span className="field-label">Tipo</span>
                  <select name="channel" className="input" defaultValue="call">
                    {Object.entries(INTERACTION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="field"><span className="field-label">Resultado</span>
                  <select name="outcome" className="input" defaultValue="done">
                    {Object.entries(INTERACTION_OUTCOME_LABEL).map(([value, label]) => <option key={value} value={value}>{label.charAt(0).toUpperCase() + label.slice(1)}</option>)}
                  </select>
                </label>
                <label className="field"><span className="field-label">Quando</span>
                  <input name="occurredAt" type="datetime-local" className="input" defaultValue={nowLocal} max={nowLocal} />
                </label>
                <label className="field"><span className="field-label">Próximo contato (opcional)</span>
                  <input name="nextContactAt" type="datetime-local" className="input" disabled={!editable} />
                </label>
              </div>
              <label className="sr-only" htmlFor="interaction-summary">Resumo do contato</label>
              <textarea id="interaction-summary" name="summary" className="textarea" rows={2} maxLength={1000} placeholder="O que foi conversado, objeções, combinados…" />
              <div className="cluster cluster-between">
                {editable && deal.nextContactAt ? (
                  <label className="checkbox-inline"><input type="checkbox" name="completeNextContact" value="1" defaultChecked /> Marcar o contato agendado como realizado</label>
                ) : <span />}
                <button type="submit" className="button-secondary button-sm">Registrar no histórico</button>
              </div>
            </form>
          </section>

          <section className="tile tile-compact stack-sm" aria-labelledby="note-title">
            <h3 id="note-title" className="headline">Nova observação</h3>
            <form action={addNoteAction} className="stack-xs">
              <input type="hidden" name="dealId" value={deal.id} />
              <label className="sr-only" htmlFor="note-body">Texto da observação</label>
              <textarea id="note-body" name="body" className="textarea" rows={3} maxLength={5000} required placeholder="Resumo da ligação, objeções, próximos passos…" />
              <div className="cluster cluster-end"><button type="submit" className="button-secondary button-sm">Adicionar observação</button></div>
            </form>
          </section>

          <section className="stack-sm" aria-labelledby="timeline-title">
            <h3 id="timeline-title" className="title-3">Histórico</h3>
            <p className="caption">Mostra só eventos confirmados ou registrados por alguém da equipe. Abrir o WhatsApp não gera registro.</p>
            <CrmTimeline groups={timeline} />
          </section>
        </div>

        <aside className="stack-lg crm-deal-side" aria-label="Detalhes do negócio">
          {prospect ? (
            <section className="card stack-sm" aria-labelledby="prospect-title">
              <div className="cluster cluster-between">
                <h3 id="prospect-title" className="headline">{isPerson ? "Dados da pessoa" : "Dados do prospect"}</h3>
                {editable ? <Link href={`${self}/editar`} className="button-ghost button-sm">Editar</Link> : null}
              </div>
              <dl className="kv-list crm-kv">
                {prospect.document ? <div className="kv-row"><dt>{prospect.documentType === "cpf" ? "CPF" : "CNPJ"}</dt><dd className="numeric">{prospect.documentType === "cpf" ? formatCpf(prospect.document) : formatCnpj(prospect.document)}</dd></div> : null}
                {prospect.segment ? <div className="kv-row"><dt>Segmento</dt><dd>{prospect.segment}</dd></div> : null}
                {prospect.contactName ? <div className="kv-row"><dt>Responsável</dt><dd>{prospect.contactName}{prospect.contactRole ? ` · ${prospect.contactRole}` : ""}</dd></div> : prospect.contactRole ? <div className="kv-row"><dt>Função</dt><dd>{prospect.contactRole}</dd></div> : null}
                {prospect.whatsapp ? <div className="kv-row"><dt>WhatsApp</dt><dd><WhatsAppLink phone={prospect.whatsapp} name={prospect.contactName ?? prospect.name} /></dd></div> : null}
                {prospect.phone ? <div className="kv-row"><dt>Telefone</dt><dd><WhatsAppLink phone={prospect.phone} name={prospect.contactName ?? prospect.name} /></dd></div> : null}
                {prospect.phoneSecondary ? <div className="kv-row"><dt>Adicional</dt><dd><WhatsAppLink phone={prospect.phoneSecondary} name={prospect.contactName ?? prospect.name} /></dd></div> : null}
                {prospect.email ? <div className="kv-row"><dt>E-mail</dt><dd><a className="text-link" href={`mailto:${prospect.email}`}>{prospect.email}</a></dd></div> : null}
                {prospect.website ? <div className="kv-row"><dt>Site</dt><dd><a className="text-link" href={/^https?:\/\//i.test(prospect.website) ? prospect.website : `https://${prospect.website}`} target="_blank" rel="noopener noreferrer nofollow">{prospect.website}</a></dd></div> : null}
                {prospect.address ? <div className="kv-row"><dt>Endereço</dt><dd>{prospect.address}</dd></div> : null}
                <div className="kv-row"><dt>Origem</dt><dd>{PROSPECT_ORIGIN_LABEL[prospect.origin]}{prospect.originDetail ? ` · ${prospect.originDetail}` : ""}</dd></div>
              </dl>
              {prospect.tags.length ? <div className="inline-list">{prospect.tags.map((tag) => <span key={tag} className="pill">{tag}</span>)}</div> : null}
            </section>
          ) : null}

          <section className="card stack-sm" aria-labelledby="next-title">
            <h3 id="next-title" className="headline">Próximo contato</h3>
            {deal.nextContactAt ? (
              <p className={`footnote${isPast(deal.nextContactAt) ? " crm-overdue" : ""}`}>{isPast(deal.nextContactAt) ? "Atrasado: " : "Agendado para "}<strong>{formatDateTime(deal.nextContactAt)}</strong></p>
            ) : <p className="footnote">Nenhum contato agendado.</p>}
            {editable ? (
              <div className="stack-xs">
                <form action={scheduleNextContactAction} className="cluster crm-next-form">
                  <input type="hidden" name="dealId" value={deal.id} />
                  <label className="field"><span className="field-label">Agendar para</span>
                    <input name="nextContactAt" type="datetime-local" className="input" required defaultValue={toLocalInput(deal.nextContactAt)} />
                  </label>
                  <button type="submit" className="button-secondary button-sm">Agendar</button>
                </form>
                {deal.nextContactAt ? (
                  <form action={scheduleNextContactAction}>
                    <input type="hidden" name="dealId" value={deal.id} />
                    <input type="hidden" name="clear" value="1" />
                    <button type="submit" className="button-ghost button-sm">Remover agendamento</button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="card stack-sm" aria-labelledby="details-title">
            <h3 id="details-title" className="headline">Negócio</h3>
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
                <label className="field"><span className="field-label">Prioridade</span>
                  <select name="priority" className="input" defaultValue={deal.priority}>
                    {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
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
              {!editable ? <p className="footnote">Somente o responsável ou um administrador edita este negócio. Você ainda pode registrar contatos, observações e tarefas.</p> : <div className="cluster cluster-end"><button type="submit" className="button-secondary button-sm">Salvar</button></div>}
            </form>

            <form action={updateDealAction} className="stack-xs">
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="returnTo" value={self} />
              <label className="field"><span className="field-label">Responsável comercial</span>
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
              <div className="kv-row"><dt>Entrada no CRM</dt><dd>{SOURCE_LABEL[deal.source]}</dd></div>
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
                      <span className="footnote">{[contact.jobTitle, contact.email].filter(Boolean).join(" · ") || (contact.phone || contact.whatsapp ? "" : "Sem dados de contato")}</span>
                      {contact.whatsapp ? <span className="footnote">WhatsApp: <WhatsAppLink phone={contact.whatsapp} name={contact.name} /></span> : null}
                      {contact.phone ? <span className="footnote">Telefone: <WhatsAppLink phone={contact.phone} name={contact.name} /></span> : null}
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
                  <label className="field"><span className="field-label">WhatsApp</span><input name="whatsapp" type="tel" inputMode="tel" className="input" maxLength={40} autoComplete="off" /></label>
                  <label className="field"><span className="field-label">Telefone</span><input name="phone" type="tel" inputMode="tel" className="input" maxLength={40} autoComplete="off" /></label>
                </div>
                <label className="field"><span className="field-label">E-mail</span><input name="email" type="email" className="input" autoComplete="off" /></label>
                {editable ? <label className="checkbox-inline"><input type="checkbox" name="makePrimary" value="1" /> Definir como contato principal</label> : null}
                <div className="cluster cluster-end"><button type="submit" className="button-secondary button-sm">Salvar contato</button></div>
              </form>
            </details>
          </section>

          {canDeleteDeal(actor, deal) ? (
            isProspect ? (
              <details className="crm-disclosure crm-danger-zone">
                <summary>Excluir prospect…</summary>
                <form action={deleteDealAction} className="stack-xs crm-subform">
                  <input type="hidden" name="dealId" value={deal.id} />
                  <p className="footnote">Apaga o cadastro manual, contatos, observações, tarefas e o histórico deste negócio. Não pode ser desfeito.</p>
                  <button type="submit" className="button-ghost button-sm is-destructive">Confirmar exclusão definitiva</button>
                </form>
              </details>
            ) : (
              <form action={deleteDealAction} className="crm-danger-zone">
                <input type="hidden" name="dealId" value={deal.id} />
                <button type="submit" className="button-ghost button-sm is-destructive">Remover do CRM</button>
                <p className="footnote">Apaga notas, tarefas e o negócio. A empresa, as listas e os contatos permanecem.</p>
              </form>
            )
          ) : null}
        </aside>
      </div>
    </>
  );
}
