"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { applyMove, groupByStage, sumAmounts } from "@/lib/crm/board";
import { formatCents } from "@/lib/crm/input";
import type { PipelineStage } from "@/lib/crm/types";

/** Dados mínimos e serializáveis de um card (a empresa vem de establishments). */
export type BoardDeal = {
  id: string;
  stageId: string;
  position: number;
  href: string;
  companyName: string;
  subtitle: string;
  amountCents: number | null;
  ownerName: string | null;
  openTasks: number;
  nextTaskDueAt: string | null;
  sourceLabel: string;
  canMove: boolean;
};

type MoveAction = (dealId: string, toStageId: string, toIndex: number) => Promise<{ ok: boolean; error?: string }>;

type DragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  active: boolean;
  overStageId: string | null;
  overIndex: number;
};

const MOUSE_ACTIVATION_PX = 5;
const EDGE_PX = 56;

function initials(name: string | null) {
  if (!name) return "—";
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "—";
}

function dueLabel(value: string | null, now: number) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const overdue = date.getTime() < now;
  const label = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });
  return { overdue, label };
}

function DealCardBody({ deal, now }: { deal: BoardDeal; now: number }) {
  const due = dueLabel(deal.nextTaskDueAt, now);
  return (
    <>
      <span className="crm-card-subtitle">{deal.subtitle}</span>
      <div className="crm-card-meta">
        <span className="crm-card-amount numeric">{deal.amountCents !== null ? formatCents(deal.amountCents) : "Sem valor"}</span>
        {deal.openTasks > 0 ? (
          <span className={`crm-card-task${due?.overdue ? " is-overdue" : ""}`} title={due ? `Próxima tarefa: ${due.label}` : undefined}>
            {deal.openTasks} tarefa{deal.openTasks > 1 ? "s" : ""}{due ? ` · ${due.label}` : ""}
          </span>
        ) : null}
        <span className="crm-avatar" title={deal.ownerName ? `Responsável: ${deal.ownerName}` : "Sem responsável"} aria-label={deal.ownerName ? `Responsável: ${deal.ownerName}` : "Sem responsável"}>
          {initials(deal.ownerName)}
        </span>
      </div>
    </>
  );
}

/**
 * Kanban do CRM.
 *
 * - Arrastar com mouse (card inteiro) ou toque (alça ⠿, para não travar a rolagem).
 * - Seletor "Mover para" em cada card: teclado, leitores de tela e celular.
 * - Atualização otimista; o servidor recalcula a posição e, em erro, o quadro volta.
 */
export function KanbanBoard({ stages, deals, moveAction, now: nowProp }: { stages: PipelineStage[]; deals: BoardDeal[]; moveAction: MoveAction; now?: number }) {
  const [cards, setCards] = useState(deals);
  const [sourceDeals, setSourceDeals] = useState(deals);
  if (sourceDeals !== deals) {
    // Nova versão do servidor (após revalidação): ela é a verdade.
    setSourceDeals(deals);
    setCards(deals);
  }
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => nowProp ?? Date.now());
  const liveId = useId();

  const columns = groupByStage(stages, cards);
  const stageName = useCallback((id: string) => stages.find((stage) => stage.id === id)?.name ?? "etapa", [stages]);

  const commitMove = useCallback(
    (dealId: string, toStageId: string, toIndex: number) => {
      const previous = cards;
      const moving = previous.find((card) => card.id === dealId);
      if (!moving) return;
      const result = applyMove(previous, dealId, toStageId, toIndex);
      const before = previous.filter((card) => card.stageId === toStageId).sort((a, b) => a.position - b.position).map((card) => card.id);
      const after = result.cards.filter((card) => card.stageId === toStageId).sort((a, b) => a.position - b.position).map((card) => card.id);
      if (moving.stageId === toStageId && before.join() === after.join()) return;

      setCards(result.cards);
      setError("");
      setAnnouncement(`${moving.companyName} movida para ${stageName(toStageId)}.`);
      startTransition(async () => {
        const response = await moveAction(dealId, toStageId, toIndex).catch(() => ({ ok: false, error: "Falha de conexão." }));
        if (!response.ok) {
          setCards(previous);
          setError(response.error ?? "Não foi possível mover o negócio.");
          setAnnouncement(`Movimento desfeito: ${response.error ?? "erro"}`);
        }
      });
    },
    [cards, moveAction, stageName]
  );

  const locateTarget = useCallback((x: number, y: number, dealId: string) => {
    const element = document.elementFromPoint(x, y);
    const column = element?.closest<HTMLElement>("[data-column-stage]");
    if (!column) return { overStageId: null, overIndex: 0 };
    const stageId = column.dataset.columnStage ?? null;
    const items = Array.from(column.querySelectorAll<HTMLElement>("[data-card-id]")).filter((item) => item.dataset.cardId !== dealId);
    let index = items.findIndex((item) => {
      const rect = item.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    if (index < 0) index = items.length;
    return { overStageId: stageId === "__orphan__" ? null : stageId, overIndex: index };
  }, []);

  // Rolagem automática perto das bordas durante o arraste.
  useEffect(() => {
    if (!drag?.active) return;
    let frame = 0;
    const tick = () => {
      const state = dragRef.current;
      const board = boardRef.current;
      if (state?.active && board) {
        const rect = board.getBoundingClientRect();
        if (state.x < rect.left + EDGE_PX) board.scrollLeft -= 14;
        else if (state.x > rect.right - EDGE_PX) board.scrollLeft += 14;
        if (state.y < EDGE_PX) window.scrollBy(0, -14);
        else if (state.y > window.innerHeight - EDGE_PX) window.scrollBy(0, 14);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag?.active]);

  const update = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      let active = state.active;
      if (!active && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >= MOUSE_ACTIVATION_PX) active = true;
      if (!active) return;
      event.preventDefault();
      const target = locateTarget(event.clientX, event.clientY, state.id);
      update({ ...state, active, x: event.clientX, y: event.clientY, ...target });
    };
    const onEnd = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      update(null);
      if (state.active) {
        suppressClickRef.current = true;
        window.setTimeout(() => (suppressClickRef.current = false), 0);
        if (event.type === "pointerup" && state.overStageId) commitMove(state.id, state.overStageId, state.overIndex);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) {
        update(null);
        setAnnouncement("Arraste cancelado.");
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("keydown", onKey);
    };
    // O efeito só precisa ser reinstalado ao iniciar/terminar um arraste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag === null, commitMove, locateTarget, update]);

  function startDrag(event: React.PointerEvent<HTMLElement>, deal: BoardDeal) {
    if (!deal.canMove || event.button !== 0 || pending) return;
    const target = event.target as HTMLElement;
    const fromHandle = Boolean(target.closest("[data-drag-handle]"));
    // Toque: só pela alça (o resto do card continua rolando a página).
    if (event.pointerType !== "mouse" && !fromHandle) return;
    if (!fromHandle && target.closest("a, button, select, input, textarea, label")) {
      // Links podem iniciar arraste com mouse; demais controles não.
      if (!target.closest("a")) return;
    }
    const card = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const immediate = fromHandle && event.pointerType !== "mouse";
    if (immediate) event.preventDefault();
    update({
      id: deal.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - card.left,
      offsetY: event.clientY - card.top,
      width: card.width,
      active: immediate,
      overStageId: immediate ? deal.stageId : null,
      overIndex: 0
    });
  }

  const dragged = drag?.active ? cards.find((card) => card.id === drag.id) ?? null : null;

  return (
    <div className="crm-board-shell">
      <p id={liveId} className="sr-only" aria-live="polite">{announcement}</p>
      {error ? <div className="notice danger" role="alert">{error}</div> : null}
      <div ref={boardRef} className={`crm-board${drag?.active ? " is-dragging" : ""}`} aria-describedby={liveId} aria-busy={pending}>
        {columns.map(({ stage, cards: columnCards }) => {
          const isOver = drag?.active && drag.overStageId === stage.id;
          const visible = columnCards.filter((card) => !(drag?.active && card.id === drag.id));
          return (
            <section key={stage.id} className={`crm-column is-${stage.kind}${isOver ? " is-over" : ""}`} data-column-stage={stage.id} aria-label={`Etapa ${stage.name}`}>
              <header className="crm-column-header">
                <span className="crm-column-dot" aria-hidden="true" />
                <h3 className="crm-column-title">{stage.name}</h3>
                <span className="crm-column-count">{columnCards.length}</span>
                <span className="crm-column-total numeric">{formatCents(sumAmounts(columnCards))}</span>
              </header>
              <ol className="crm-column-list">
                {visible.map((deal, index) => (
                  <li key={deal.id} className="crm-card-slot">
                    {isOver && drag?.overIndex === index ? <div className="crm-drop-indicator" aria-hidden="true" /> : null}
                    <article
                      className={`crm-card${deal.canMove ? " is-movable" : ""}`}
                      data-card-id={deal.id}
                      onPointerDown={(event) => startDrag(event, deal)}
                      onClickCapture={(event) => {
                        if (suppressClickRef.current) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                    >
                      <div className="crm-card-head">
                        <Link href={deal.href} className="crm-card-title" draggable={false}>{deal.companyName}</Link>
                        {deal.canMove ? (
                          <button type="button" className="crm-drag-handle" data-drag-handle aria-label={`Arrastar ${deal.companyName}`} title="Arrastar">
                            <svg viewBox="0 0 12 16" width="12" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.4" /><circle cx="9" cy="3" r="1.4" /><circle cx="3" cy="8" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="3" cy="13" r="1.4" /><circle cx="9" cy="13" r="1.4" /></g></svg>
                          </button>
                        ) : null}
                      </div>
                      <DealCardBody deal={deal} now={now} />
                      <div className="crm-card-foot">
                        <span className="crm-card-source">{deal.sourceLabel}</span>
                        {deal.canMove ? (
                          <label className="crm-move">
                            <span className="sr-only">Mover {deal.companyName} para</span>
                            <select
                              className="crm-move-select"
                              value={deal.stageId}
                              disabled={pending}
                              onChange={(event) => commitMove(deal.id, event.target.value, 0)}
                            >
                              {stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                            </select>
                          </label>
                        ) : (
                          <span className="crm-card-locked" title="Somente o responsável ou um administrador move este negócio">Somente leitura</span>
                        )}
                      </div>
                    </article>
                  </li>
                ))}
                {isOver && drag && drag.overIndex >= visible.length ? <li className="crm-card-slot" aria-hidden="true"><div className="crm-drop-indicator" /></li> : null}
                {visible.length === 0 && !isOver ? <li className="crm-column-empty">Nenhum negócio</li> : null}
              </ol>
            </section>
          );
        })}
      </div>
      {dragged && drag ? (
        <div className="crm-card crm-card-overlay" style={{ width: drag.width, transform: `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0)` }} aria-hidden="true">
          <div className="crm-card-head"><span className="crm-card-title">{dragged.companyName}</span></div>
          <DealCardBody deal={dragged} now={now} />
        </div>
      ) : null}
    </div>
  );
}
