"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { formatCnpj, formatDate } from "@/lib/format";

/**
 * Busca rápida (Fase 7): texto livre com tolerância a erro de digitação.
 *
 * Mostra duas coisas, sempre separadas:
 *  1. "Buscar empresas novas" — interpretação da consulta (CNAE + cidade) que abre o
 *     formulário já preenchido. A busca em si continua na Casa dos Dados.
 *  2. "Na sua base" — empresas que o usuário já pode ver (listas liberadas, salvas, CRM),
 *     encontradas pelo índice de pesquisa (ou pelo banco, se o índice estiver fora do ar).
 */

type Hit = {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  primaryCnaeLabel: string | null;
  city: string | null;
  stateCode: string | null;
  registrationStatus: string | null;
  sourceFetchedAt: string | null;
};

type Discovery = { label: string; href: string; cnaes: Array<{ formattedCode: string }>; city: { confidence: "high" | "low" } | null };

type ResponseBody = {
  engine?: "meilisearch" | "database";
  degraded?: boolean;
  hits?: Hit[];
  totalHits?: number;
  totalIsEstimate?: boolean;
  discovery?: Discovery | null;
  error?: string;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; body: ResponseBody };

export function CompanyOmnibox() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const inputId = useId();
  const resultsId = useId();

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ status: "loading" });
      try {
        const response = await fetch(`/api/search/companies?limit=6&q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const body = (await response.json().catch(() => ({}))) as ResponseBody;
        if (!response.ok) {
          setState({ status: "error", message: body.error ?? "Não foi possível pesquisar agora." });
          return;
        }
        setState({ status: "ready", body });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setState({ status: "error", message: "Não foi possível pesquisar agora." });
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const visible = query.trim().length >= 2 ? state : ({ status: "idle" } as State);
  const body = visible.status === "ready" ? visible.body : null;
  const hits = body?.hits ?? [];

  return (
    <div className="omnibox" role="search">
      <label className="field" htmlFor={inputId}>
        <span className="field-label">Busca rápida</span>
        <input
          id={inputId}
          className="input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          placeholder="Ex.: transportadoras pato branco, razão social, nome fantasia ou CNPJ"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-controls={resultsId}
        />
        <span className="field-help">Aceita erros de digitação e acentos. Empresas novas continuam sendo buscadas na Casa dos Dados.</span>
      </label>

      <div id={resultsId} className="omnibox-results" aria-live="polite" aria-busy={visible.status === "loading"}>
        {visible.status === "loading" ? <p className="footnote">Pesquisando…</p> : null}
        {visible.status === "error" ? <div className="notice warning">{visible.message}</div> : null}

        {body?.discovery ? (
          <Link className="omnibox-discovery card card-flat" href={body.discovery.href}>
            <span className="eyebrow">Buscar empresas novas</span>
            <strong>{body.discovery.label}</strong>
            <span className="footnote">
              CNAE {body.discovery.cnaes.map((cnae) => cnae.formattedCode).join(", ")}
              {body.discovery.city?.confidence === "low" ? " · confira a cidade antes de buscar" : ""} · abre o formulário preenchido
            </span>
          </Link>
        ) : null}

        {body ? (
          <section aria-label="Empresas na sua base">
            <div className="omnibox-heading">
              <span className="eyebrow">Na sua base</span>
              <span className="footnote">
                {hits.length === 0
                  ? "Nenhuma empresa liberada, salva ou no CRM corresponde."
                  : `${body.totalIsEstimate ? "~" : ""}${body.totalHits ?? hits.length} encontrada(s)`}
              </span>
            </div>
            {body.degraded ? (
              <p className="footnote">Busca simplificada no momento (sem tolerância a erros de digitação).</p>
            ) : null}
            {hits.length > 0 ? (
              <ul className="omnibox-list">
                {hits.map((hit) => (
                  <li key={hit.cnpj}>
                    <Link href={`/dashboard/companies/${hit.cnpj}`} className="omnibox-hit">
                      <strong>{hit.tradeName ?? hit.legalName}</strong>
                      <span className="footnote">
                        {hit.tradeName ? `${hit.legalName} · ` : ""}
                        {formatCnpj(hit.cnpj)}
                        {hit.city ? ` · ${hit.city}${hit.stateCode ? `/${hit.stateCode}` : ""}` : ""}
                        {hit.registrationStatus && hit.registrationStatus !== "ATIVA" ? ` · ${hit.registrationStatus}` : ""}
                      </span>
                      {hit.primaryCnaeLabel ? <span className="footnote">{hit.primaryCnaeLabel}</span> : null}
                      {hit.sourceFetchedAt ? (
                        <span className="footnote">Casa dos Dados em {formatDate(hit.sourceFetchedAt)} · revalidado ao abrir</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
