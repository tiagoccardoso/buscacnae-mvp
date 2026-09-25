"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { AiAnswerCard } from "@/components/ai/ai-answer-card";
import { SparkleIcon } from "@/components/ui/icons";
import { dispatchAiCommand } from "@/lib/ai/ui-bus";
import type { AiAction, AiAnswer, AiToolCall, AiUiCommand, AiView } from "@/lib/ai/types";
import { MAP_LAYER_PARAM } from "@/lib/map/types";
import { pickFilterQuery, writeCompanyFilters } from "@/lib/results/filter-params";

/**
 * “Pergunte ao BuscaCNAE” — painel de perguntas em linguagem natural sobre a busca aberta.
 *
 * - Envia a pergunta + contexto (aba atual, filtros da URL, última análise) para o servidor;
 *   o servidor devolve a resposta calculada (nada é calculado aqui nem pelo modelo).
 * - Executa o comando de interface quando o usuário pediu ("mostre no mapa", "filtre…"):
 *   na mesma aba, pelo canal `ui-bus`; em outra aba, por navegação com os filtros na URL.
 * - Conversa guardada na sessionStorage da aba do navegador (por busca), para sobreviver à
 *   troca Empresas ↔ Mapa ↔ Inteligência.
 */

type Message = {
  id: string;
  question: string;
  answer: AiAnswer | null;
  error: string | null;
  commandApplied: boolean;
};

type Stored = { messages: Message[]; previous: AiToolCall | null; queryAtAnswer: string | null; open: boolean };

type AskBuscaCnaeProps = {
  searchId: string;
  view: AiView;
  /** Rota da API (padrão /api/ai/ask). */
  endpoint?: string;
  /** Base dos links das abas (padrão /dashboard/search/{id}). */
  resultsHref?: string;
  /** Valor de ?view= da aba Empresas na base (padrão: nenhum). */
  listView?: string | null;
  /** Prefixo do link da ficha da empresa (null = sem link). */
  companyHrefBase?: string | null;
  headline?: string;
};

const MAX_MESSAGES = 20;
const MAX_LENGTH = 500;

const SUGGESTIONS: Record<AiView, string[]> = {
  lista: ["Quantas empresas estão ativas?", "Quais municípios têm mais empresas?", "Liste as 10 com maior capital social"],
  mapa: ["Quais cidades possuem mais?", "Mostre a concentração no mapa", "Compare as duas cidades com mais empresas"],
  inteligencia: ["Resuma as empresas abertas nos últimos 2 anos", "Mostre em gráfico por porte", "Evolução de abertura por ano"]
};

const VIEW_LABELS: Record<AiView, string> = { lista: "Empresas", mapa: "Mapa", inteligencia: "Inteligência" };

const subscribeNothing = () => () => {};

function storageKey(searchId: string) {
  return `buscacnae:ai:${searchId}`;
}

function readStored(searchId: string): Stored {
  const empty: Stored = { messages: [], previous: null, queryAtAnswer: null, open: false };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.sessionStorage.getItem(storageKey(searchId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages.filter((message) => message && message.answer).slice(-MAX_MESSAGES) : [],
      previous: parsed.previous ?? null,
      queryAtAnswer: typeof parsed.queryAtAnswer === "string" ? parsed.queryAtAnswer : null,
      open: parsed.open === true
    };
  } catch {
    return empty;
  }
}

function commandQuery(command: AiUiCommand) {
  return writeCompanyFilters(new URLSearchParams(), command.filters).toString();
}

export function AskBuscaCnae({ searchId, view, endpoint = "/api/ai/ask", resultsHref, listView = null, companyHrefBase = null, headline }: AskBuscaCnaeProps) {
  const router = useRouter();
  const titleId = useId();
  const inputId = useId();
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [stored, setStored] = useState<Stored>(() => readStored(searchId));
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const { messages, open } = stored;

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey(searchId), JSON.stringify({ ...stored, messages: stored.messages.filter((message) => message.answer) }));
    } catch {
      /* sessionStorage indisponível (modo privado): a conversa só não sobrevive à navegação. */
    }
  }, [stored, searchId]);

  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, pending]);

  useEffect(() => () => controller.current?.abort(), []);

  const base = resultsHref ?? `/dashboard/search/${searchId}`;

  /** Executa um comando de interface de forma controlada. Devolve a query aplicada. */
  const execute = useCallback(
    (command: AiUiCommand) => {
      const query = commandQuery(command);
      if (command.view === view) {
        dispatchAiCommand(command);
        return query;
      }
      const params = new URLSearchParams(query);
      const viewParam = command.view === "lista" ? listView : command.view;
      if (viewParam) params.set("view", viewParam);
      if (command.view === "mapa" && command.layer) params.set("camada", MAP_LAYER_PARAM[command.layer]);
      const [path, baseQuery = ""] = base.split("?");
      const merged = new URLSearchParams(baseQuery);
      for (const [key, value] of params) merged.set(key, value);
      const search = merged.toString();
      router.push(`${path}${search ? `?${search}` : ""}`, { scroll: false });
      return query;
    },
    [base, listView, router, view]
  );

  const ask = useCallback(
    async (rawQuestion: string, options: { reset?: boolean } = {}) => {
      const question = rawQuestion.trim().slice(0, MAX_LENGTH);
      if (!question || pending) return;
      const currentQuery = pickFilterQuery(window.location.search);
      const usePrevious = !options.reset && stored.previous && stored.queryAtAnswer === currentQuery;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setStored((current) => ({
        ...current,
        messages: [...current.messages, { id, question, answer: null, error: null, commandApplied: false }].slice(-MAX_MESSAGES)
      }));
      setInput("");
      setPending(true);
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            searchId,
            question,
            context: {
              view,
              urlFilters: Object.fromEntries(new URLSearchParams(currentQuery)),
              previous: usePrevious ? stored.previous : null,
              reset: options.reset === true
            }
          }),
          signal: request.signal
        });
        const body = (await response.json().catch(() => null)) as (AiAnswer & { error?: string }) | null;
        if (!response.ok || !body || body.error) throw new Error(body?.error || "Não foi possível responder agora.");
        let applied = false;
        let queryAtAnswer = currentQuery;
        if (body.uiCommand) {
          queryAtAnswer = execute(body.uiCommand);
          applied = true;
        }
        setStored((current) => ({
          ...current,
          previous: body.context ?? (options.reset ? null : current.previous),
          queryAtAnswer,
          messages: current.messages.map((message) => (message.id === id ? { ...message, answer: body, commandApplied: applied } : message))
        }));
      } catch (error) {
        if (request.signal.aborted) return;
        const text = error instanceof Error && error.message ? error.message : "Não foi possível responder agora.";
        setStored((current) => ({
          ...current,
          messages: current.messages.map((message) => (message.id === id ? { ...message, error: text } : message))
        }));
      } finally {
        if (controller.current === request) {
          controller.current = null;
          setPending(false);
        }
      }
    },
    [endpoint, execute, pending, searchId, stored.previous, stored.queryAtAnswer, view]
  );

  const onAction = useCallback(
    (action: AiAction) => {
      if ("command" in action) {
        const query = execute(action.command);
        setStored((current) => ({ ...current, queryAtAnswer: query }));
      } else if ("question" in action) void ask(action.question);
    },
    [ask, execute]
  );

  const setOpen = (value: boolean) => {
    setStored((current) => ({ ...current, open: value }));
    if (value) window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(input);
    }
    if (event.key === "Escape") setOpen(false);
  };

  const reset = () => {
    controller.current?.abort();
    setPending(false);
    setStored({ messages: [], previous: null, queryAtAnswer: null, open: true });
  };

  if (!hydrated || !open) {
    return (
      <button type="button" className="ai-launcher button" onClick={() => setOpen(true)} aria-expanded="false" aria-controls={titleId}>
        <SparkleIcon /> Pergunte ao BuscaCNAE
      </button>
    );
  }

  return (
    <section className="ai-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <header className="ai-panel-head">
        <div>
          <h2 id={titleId} className="headline">
            <SparkleIcon /> Pergunte ao BuscaCNAE
          </h2>
          <p className="ai-muted">Dados desta busca · números calculados pelo sistema, não pela IA.</p>
        </div>
        <div className="ai-panel-tools">
          {messages.length > 0 ? (
            <button type="button" className="button-ghost button-sm" onClick={reset}>
              Nova conversa
            </button>
          ) : null}
          <button type="button" className="button-ghost button-sm" onClick={() => setOpen(false)} aria-label="Fechar assistente">
            Fechar
          </button>
        </div>
      </header>

      <div className="ai-messages" ref={listRef} aria-live="polite" aria-busy={pending ? "true" : "false"}>
        {messages.length === 0 ? (
          <div className="ai-empty">
            <p className="ai-muted">
              Pergunte em português sobre as empresas desta busca{headline ? ` (${headline})` : ""}. Os filtros da aba {VIEW_LABELS[view]} entram como
              contexto.
            </p>
            <div className="ai-followups">
              {SUGGESTIONS[view].map((question) => (
                <button key={question} type="button" className="ai-chip" onClick={() => void ask(question)}>
                  {question}
                </button>
              ))}
            </div>
            <p className="ai-legend">
              <span className="ai-tag ai-tag-dado">Dado</span> registro da fonte · <span className="ai-tag ai-tag-calculo">Cálculo</span> motor
              determinístico · <span className="ai-tag ai-tag-ia">Interpretação da IA</span> texto do modelo
            </p>
          </div>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className="ai-turn">
            <p className="ai-question">{message.question}</p>
            {message.answer ? (
              <AiAnswerCard
                answer={message.answer}
                companyHrefBase={companyHrefBase}
                onAction={onAction}
                onAsk={(question, options) => void ask(question, options)}
                commandApplied={message.commandApplied}
              />
            ) : message.error ? (
              <p className="notice danger" role="alert">
                {message.error}
              </p>
            ) : (
              <p className="ai-thinking" role="status">
                <span className="spinner" aria-hidden="true" /> Consultando os dados da busca…
              </p>
            )}
          </div>
        ))}
      </div>

      <form className="ai-form" onSubmit={onSubmit}>
        <label htmlFor={inputId} className="sr-only">
          Sua pergunta
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          className="input ai-input"
          rows={2}
          maxLength={MAX_LENGTH}
          value={input}
          placeholder="Ex.: Quais municípios têm mais empresas ativas?"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="button" disabled={pending || !input.trim()} aria-busy={pending ? "true" : undefined}>
          Perguntar
        </button>
      </form>
    </section>
  );
}
