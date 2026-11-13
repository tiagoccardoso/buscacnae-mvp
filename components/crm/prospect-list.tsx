"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { bulkDealsAction, dealsHistoryCheck, type BulkDealsInput, type BulkDealsResponse } from "@/app/dashboard/crm/actions";
import { logInteractionAction, scheduleNextContactAction } from "@/app/dashboard/crm/prospect-actions";
import { WhatsAppIcon } from "@/components/crm/whatsapp-link";
import type { PipelineStage } from "@/lib/crm/types";

/** Linha serializável da listagem (montada no servidor; datas já formatadas). */
export type ProspectRow = {
  id: string;
  href: string;
  editHref: string;
  name: string;
  subtitle: string;
  isManual: boolean;
  stageId: string;
  stageKind: "open" | "won" | "lost";
  ownerName: string | null;
  amountLabel: string | null;
  nextContactLabel: string | null;
  nextContactOverdue: boolean;
  openTasks: number;
  proposalPending: boolean;
  lastInteractionLabel: string | null;
  daysSinceTouch: number | null;
  stale: boolean;
  sourceLabel: string;
  archived: boolean;
  canEdit: boolean;
  canDelete: boolean;
  whatsappUrl: string | null;
  whatsappDisplay: string | null;
  whatsappProblem: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  updatedLabel: string;
};

type Feedback = { tone: "success" | "warning" | "danger"; text: string } | null;

type DeleteState = { ids: string[]; names: string[]; checking: boolean; withHistory: string[]; acknowledged: boolean; skipped: number } | null;

const CHANNELS = [
  ["call", "Ligação"],
  ["whatsapp", "WhatsApp"],
  ["meeting", "Reunião"],
  ["email", "E-mail"],
  ["visit", "Visita"],
  ["other", "Outro"]
] as const;

const OUTCOMES = [
  ["done", "Realizado"],
  ["no_answer", "Sem resposta"],
  ["scheduled", "Reagendado"]
] as const;

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fallback (contexto sem permissão de clipboard).
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.7 10.1a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-10.1M8.5 9v5M11.5 9v5" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="currentColor">
      <circle cx="4.5" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="15.5" cy="10" r="1.6" />
    </svg>
  );
}

/** Diálogo nativo (<dialog>): foco preso, Esc fecha e o foco volta para quem abriu. */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handle = () => onClose();
    dialog.addEventListener("close", handle);
    return () => dialog.removeEventListener("close", handle);
  }, [onClose]);
  return ref;
}

type MenuItem =
  | { kind: "link"; label: string; href: string; external?: boolean }
  | { kind: "button"; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string };

/** Menu de ações da linha: botão com aria-expanded + lista role="menu" navegável por setas. */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const focusItem = (index: number) => {
    const elements = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])") ?? []);
    if (!elements.length) return;
    elements[(index + elements.length) % elements.length]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const elements = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])") ?? []);
    const current = elements.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(elements.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="crm-row-menu">
      <button
        ref={buttonRef}
        type="button"
        className="button-icon crm-row-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Mais ações para ${label}`}
        title="Mais ações"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreIcon />
      </button>
      {open ? (
        <>
          <div className="crm-row-menu-scrim" aria-hidden="true" onClick={() => close(false)} />
          <div ref={menuRef} id={menuId} role="menu" aria-label={`Ações para ${label}`} className="crm-row-menu-list" onKeyDown={onKeyDown}>
            <p className="crm-row-menu-title" aria-hidden="true">{label}</p>
            {items.map((item, index) =>
              item.kind === "link" ? (
                <Link
                  key={index}
                  role="menuitem"
                  href={item.href}
                  className="crm-row-menu-item"
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                  {item.external ? <span className="sr-only"> (abre em nova aba)</span> : null}
                </Link>
              ) : (
                <button
                  key={index}
                  type="button"
                  role="menuitem"
                  aria-disabled={item.disabled || undefined}
                  className={`crm-row-menu-item${item.danger ? " is-danger" : ""}`}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <span>{item.label}</span>
                  {item.hint ? <span className="crm-row-menu-hint">{item.hint}</span> : null}
                </button>
              )
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ProspectList({ rows, stages, returnTo, archivedView }: { rows: ProspectRow[]; stages: PipelineStage[]; returnTo: string; archivedView: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<DeleteState>(null);
  const [interactionFor, setInteractionFor] = useState<ProspectRow | null>(null);
  const [scheduleFor, setScheduleFor] = useState<ProspectRow | null>(null);
  const [bulkStage, setBulkStage] = useState("");
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();

  // Seleção só com ids visíveis (após filtrar/paginar/excluir, nada "fantasma" fica marcado).
  const [rowsKey, setRowsKey] = useState(rows);
  if (rowsKey !== rows) {
    setRowsKey(rows);
    const visible = new Set(rows.map((row) => row.id));
    setSelected((current) => new Set([...current].filter((id) => visible.has(id))));
  }

  const selectedRows = rows.filter((row) => selected.has(row.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedRows.length > 0 && !allSelected;
  }, [selectedRows.length, allSelected]);

  const closeDelete = useCallback(() => setDeleting(null), []);
  const closeInteraction = useCallback(() => setInteractionFor(null), []);
  const closeSchedule = useCallback(() => setScheduleFor(null), []);
  const deleteRef = useDialog(Boolean(deleting), closeDelete);
  const interactionRef = useDialog(Boolean(interactionFor), closeInteraction);
  const scheduleRef = useDialog(Boolean(scheduleFor), closeSchedule);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(input: BulkDealsInput, after?: (response: BulkDealsResponse) => void) {
    setFeedback(null);
    startTransition(async () => {
      const response = await bulkDealsAction(input).catch((): BulkDealsResponse => ({ ok: false, tone: "danger", message: "Falha de conexão. Nada foi alterado." }));
      setFeedback({ tone: response.tone, text: response.message });
      if (response.result?.done.length) {
        const done = new Set(response.result.done);
        setSelected((current) => new Set([...current].filter((id) => !done.has(id))));
        router.refresh();
      }
      after?.(response);
    });
  }

  function askDelete(targets: ProspectRow[]) {
    const allowed = targets.filter((row) => row.canDelete);
    if (!allowed.length) {
      setFeedback({ tone: "danger", text: "Você não tem permissão para excluir os prospects selecionados (somente quem criou e é responsável, ou um administrador)." });
      return;
    }
    const ids = allowed.map((row) => row.id);
    setDeleting({ ids, names: allowed.map((row) => row.name), checking: true, withHistory: [], acknowledged: false, skipped: targets.length - allowed.length });
    dealsHistoryCheck(ids)
      .then((check) => setDeleting((current) => (current && current.ids === ids ? { ...current, checking: false, withHistory: check.ok ? check.withHistory : ids } : current)))
      .catch(() => setDeleting((current) => (current && current.ids === ids ? { ...current, checking: false, withHistory: ids } : current)));
  }

  function confirmDelete(force: boolean) {
    if (!deleting) return;
    const ids = force ? deleting.ids : deleting.ids.filter((id) => !deleting.withHistory.includes(id));
    if (!ids.length) return;
    run({ op: "delete", dealIds: ids, force }, () => setDeleting(null));
  }

  function archiveFromDelete() {
    if (!deleting) return;
    const ids = deleting.withHistory.length ? deleting.withHistory : deleting.ids;
    run({ op: "archive", dealIds: ids }, () => setDeleting(null));
  }

  function copy(value: string, what: string) {
    copyText(value).then((ok) => setFeedback(ok ? { tone: "success", text: `${what} copiado.` } : { tone: "danger", text: `Não foi possível copiar o ${what.toLowerCase()}.` }));
  }

  const historyCount = deleting?.withHistory.length ?? 0;
  const cleanCount = deleting ? deleting.ids.length - historyCount : 0;
  const singleName = deleting?.names.length === 1 ? deleting.names[0] : null;

  return (
    <div className="crm-list" aria-busy={pending}>
      <div className="crm-list-feedback" role="status" aria-live="polite">
        {feedback ? <div className={`notice ${feedback.tone}`}>{feedback.text}</div> : null}
      </div>

      {selectedRows.length ? (
        <div className="crm-bulk-bar" role="region" aria-label="Ações em lote">
          <strong className="crm-bulk-count">{selectedRows.length} selecionado(s)</strong>
          <label className="crm-bulk-move">
            <span className="sr-only">Mover selecionados para a etapa</span>
            <select className="input" value={bulkStage} onChange={(event) => setBulkStage(event.target.value)} disabled={pending}>
              <option value="">Mover para…</option>
              {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            </select>
          </label>
          <button type="button" className="button-secondary button-sm" disabled={!bulkStage || pending} onClick={() => run({ op: "move", dealIds: selectedRows.map((row) => row.id), stageId: bulkStage }, () => setBulkStage(""))}>
            Mover
          </button>
          {archivedView ? (
            <button type="button" className="button-secondary button-sm" disabled={pending} onClick={() => run({ op: "restore", dealIds: selectedRows.map((row) => row.id) })}>Restaurar</button>
          ) : (
            <button type="button" className="button-secondary button-sm" disabled={pending} onClick={() => run({ op: "archive", dealIds: selectedRows.map((row) => row.id) })}>Arquivar</button>
          )}
          <button type="button" className="button-danger button-sm" disabled={pending} onClick={() => askDelete(selectedRows)}>Excluir</button>
          <button type="button" className="button-ghost button-sm" onClick={() => setSelected(new Set())}>Limpar seleção</button>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="table table-responsive crm-table" aria-labelledby={titleId}>
          <caption id={titleId} className="sr-only">Prospects do CRM</caption>
          <thead>
            <tr>
              <th scope="col" className="crm-col-check">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))}
                  aria-label="Selecionar todos os prospects desta página"
                />
              </th>
              <th scope="col">Prospect</th>
              <th scope="col">Etapa</th>
              <th scope="col">Responsável</th>
              <th scope="col" className="cell-num">Valor</th>
              <th scope="col">Última interação</th>
              <th scope="col">Próximo contato</th>
              <th scope="col">Pendências</th>
              <th scope="col">Origem</th>
              <th scope="col" className="cell-actions"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const items: MenuItem[] = [
                { kind: "link", label: "Abrir cadastro", href: row.href },
                ...(row.canEdit ? [{ kind: "link" as const, label: "Editar informações", href: row.editHref }] : []),
                row.whatsappUrl
                  ? { kind: "link" as const, label: `WhatsApp (${row.whatsappDisplay})`, href: row.whatsappUrl, external: true }
                  : { kind: "button" as const, label: "WhatsApp indisponível", hint: row.whatsappProblem ?? "Sem telefone cadastrado", disabled: true, onSelect: () => undefined },
                row.phone
                  ? { kind: "button" as const, label: "Copiar telefone", hint: row.phone, onSelect: () => copy(row.phone ?? "", "Telefone") }
                  : { kind: "button" as const, label: "Copiar telefone", hint: "Não cadastrado", disabled: true, onSelect: () => undefined },
                row.email
                  ? { kind: "button" as const, label: "Copiar e-mail", hint: row.email, onSelect: () => copy(row.email ?? "", "E-mail") }
                  : { kind: "button" as const, label: "Copiar e-mail", hint: "Não cadastrado", disabled: true, onSelect: () => undefined },
                { kind: "button", label: "Registrar interação", onSelect: () => setInteractionFor(row) },
                ...(row.canEdit ? [{ kind: "button" as const, label: "Agendar acompanhamento", onSelect: () => setScheduleFor(row) }] : []),
                ...(row.canEdit
                  ? [row.archived
                      ? { kind: "button" as const, label: "Restaurar prospect", onSelect: () => run({ op: "restore", dealIds: [row.id] }) }
                      : { kind: "button" as const, label: "Arquivar prospect", hint: "Sai da lista; histórico preservado", onSelect: () => run({ op: "archive", dealIds: [row.id] }) }]
                  : []),
                ...(row.canDelete ? [{ kind: "button" as const, label: "Excluir prospect", danger: true, onSelect: () => askDelete([row]) }] : [])
              ];
              return (
                <tr key={row.id} className={`${selected.has(row.id) ? "is-selected" : ""}${row.archived ? " is-archived" : ""}`}>
                  <td className="crm-col-check" data-label="">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Selecionar ${row.name}`} />
                  </td>
                  <td data-label="Prospect">
                    <div className="cell-stack">
                      <Link href={row.href} className="cell-strong text-link">{row.name}</Link>
                      <span className="muted">{row.subtitle}</span>
                      {row.contactName ? <span className="muted">Contato: {row.contactName}</span> : null}
                      {row.archived ? <span className="pill crm-pill-xs">Arquivado</span> : null}
                    </div>
                  </td>
                  <td data-label="Etapa">
                    {row.canEdit ? (
                      <select
                        className="input crm-stage-select"
                        value={row.stageId}
                        disabled={pending}
                        aria-label={`Etapa de ${row.name}`}
                        onChange={(event) => run({ op: "move", dealIds: [row.id], stageId: event.target.value })}
                      >
                        {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                      </select>
                    ) : (
                      <span className={`pill${row.stageKind === "won" ? " success" : row.stageKind === "lost" ? " danger" : ""}`}>{stages.find((stage) => stage.id === row.stageId)?.name ?? "—"}</span>
                    )}
                  </td>
                  <td data-label="Responsável">{row.ownerName ?? <span className="muted">Sem responsável</span>}</td>
                  <td data-label="Valor" className="cell-num">{row.amountLabel ?? <span className="muted">—</span>}</td>
                  <td data-label="Última interação">
                    <div className="cell-stack">
                      <span>{row.lastInteractionLabel ?? <span className="muted">Nenhuma registrada</span>}</span>
                      {row.stale ? <span className="pill warning crm-pill-xs" title="Sem interação nem próximo contato agendado">Sem acompanhamento{row.daysSinceTouch !== null ? ` há ${row.daysSinceTouch} d` : ""}</span> : null}
                    </div>
                  </td>
                  <td data-label="Próximo contato" className={row.nextContactOverdue ? "crm-overdue" : undefined}>
                    {row.nextContactLabel ? <>{row.nextContactOverdue ? "Atrasado · " : ""}{row.nextContactLabel}</> : <span className="muted">—</span>}
                  </td>
                  <td data-label="Pendências">
                    <div className="crm-indicators">
                      {row.proposalPending ? <span className="pill accent crm-pill-xs">Proposta pendente</span> : null}
                      {row.openTasks ? <span className="pill crm-pill-xs">{row.openTasks} tarefa(s)</span> : null}
                      {!row.proposalPending && !row.openTasks ? <span className="muted">—</span> : null}
                    </div>
                  </td>
                  <td data-label="Origem"><span className="pill crm-pill-xs">{row.sourceLabel}</span></td>
                  <td data-label="" className="cell-actions">
                    <div className="crm-row-actions">
                      {row.whatsappUrl ? (
                        <a href={row.whatsappUrl} target="_blank" rel="noopener noreferrer" className="button-icon crm-row-icon wa-link is-icon" aria-label={`Conversar com ${row.name} no WhatsApp (${row.whatsappDisplay}) — abre em nova aba`} title={`WhatsApp ${row.whatsappDisplay}`}>
                          <WhatsAppIcon />
                        </a>
                      ) : null}
                      {row.canDelete ? (
                        <button type="button" className="button-icon crm-row-icon crm-row-delete" aria-label={`Excluir prospect ${row.name}`} title="Excluir prospect" onClick={() => askDelete([row])} disabled={pending}>
                          <TrashIcon />
                        </button>
                      ) : null}
                      <RowMenu label={row.name} items={items} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <dialog ref={deleteRef} className="crm-dialog" aria-labelledby="crm-delete-title">
        {deleting ? (
          <div className="stack-sm">
            <h3 id="crm-delete-title" className="title-3">{singleName ? `Excluir “${singleName}”?` : `Excluir ${deleting.ids.length} prospects?`}</h3>
            {deleting.skipped ? (
              <p className="notice info">{deleting.skipped} prospect(s) selecionado(s) ficarão de fora: você não tem permissão para excluí-los.</p>
            ) : null}
            {deleting.checking ? (
              <p className="footnote" role="status">Verificando histórico comercial…</p>
            ) : historyCount ? (
              <>
                <div className="notice warning">
                  {singleName ? "Este prospect tem" : `${historyCount} de ${deleting.ids.length} prospects têm`} histórico comercial (notas, tarefas, interações, contatos, valor ou fechamento).
                  {" "}<strong>Recomendado: arquivar.</strong> O prospect sai da lista, mas todo o histórico fica preservado e pode ser restaurado.
                </div>
                <label className="checkbox-inline">
                  <input type="checkbox" checked={deleting.acknowledged} onChange={(event) => setDeleting({ ...deleting, acknowledged: event.target.checked })} />
                  <span>Entendo que excluir apaga definitivamente o negócio{deleting.names.length > 1 ? "s" : ""} (e, nos cadastros manuais, o prospect, contatos, notas e histórico).</span>
                </label>
              </>
            ) : (
              <p className="footnote">Esta ação não pode ser desfeita. Empresas da base continuam nos seus leads salvos; cadastros manuais são apagados com seus contatos.</p>
            )}
            <div className="cluster crm-dialog-actions">
              {historyCount ? (
                <>
                  <button type="button" className="button button-sm" onClick={archiveFromDelete} disabled={pending || deleting.checking}>Arquivar {historyCount > 1 ? `os ${historyCount}` : ""}</button>
                  {cleanCount > 0 ? (
                    <button type="button" className="button-secondary button-sm" onClick={() => confirmDelete(false)} disabled={pending}>Excluir só os {cleanCount} sem histórico</button>
                  ) : null}
                  <button type="button" className="button-danger button-sm" onClick={() => confirmDelete(true)} disabled={pending || !deleting.acknowledged}>Excluir definitivamente</button>
                </>
              ) : (
                <button type="button" className="button-danger button-sm" onClick={() => confirmDelete(false)} disabled={pending || deleting.checking}>Excluir</button>
              )}
              <button type="button" className="button-ghost button-sm" onClick={() => setDeleting(null)}>Cancelar</button>
            </div>
          </div>
        ) : null}
      </dialog>

      <dialog ref={interactionRef} className="crm-dialog" aria-labelledby="crm-interaction-title">
        {interactionFor ? (
          <form action={logInteractionAction} className="stack-sm">
            <h3 id="crm-interaction-title" className="title-3">Registrar interação · {interactionFor.name}</h3>
            <input type="hidden" name="dealId" value={interactionFor.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid-2">
              <label className="field">
                <span className="field-label">Canal</span>
                <select name="channel" className="input" defaultValue="call">
                  {CHANNELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Resultado</span>
                <select name="outcome" className="input" defaultValue="done">
                  {OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span className="field-label">Resumo (opcional)</span>
              <textarea name="summary" className="textarea" rows={3} maxLength={1000} placeholder="O que foi conversado?" />
            </label>
            {interactionFor.canEdit ? (
              <label className="field">
                <span className="field-label">Próximo contato (opcional)</span>
                <input type="datetime-local" name="nextContactAt" className="input" />
              </label>
            ) : null}
            <div className="cluster crm-dialog-actions">
              <button type="submit" className="button button-sm">Registrar</button>
              <button type="button" className="button-ghost button-sm" onClick={() => setInteractionFor(null)}>Cancelar</button>
            </div>
          </form>
        ) : null}
      </dialog>

      <dialog ref={scheduleRef} className="crm-dialog" aria-labelledby="crm-schedule-title">
        {scheduleFor ? (
          <form action={scheduleNextContactAction} className="stack-sm">
            <h3 id="crm-schedule-title" className="title-3">Agendar acompanhamento · {scheduleFor.name}</h3>
            <input type="hidden" name="dealId" value={scheduleFor.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="field">
              <span className="field-label">Data e hora do próximo contato</span>
              <input type="datetime-local" name="nextContactAt" className="input" required />
            </label>
            <div className="cluster crm-dialog-actions">
              <button type="submit" className="button button-sm">Agendar</button>
              <button type="button" className="button-ghost button-sm" onClick={() => setScheduleFor(null)}>Cancelar</button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
