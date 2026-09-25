"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { pickFilterQuery, subscribeUrlParams } from "@/lib/results/filter-params";

export type ResultsView = "lista" | "mapa" | "inteligencia";

type ResultsViewToggleProps = {
  searchId: string;
  view: ResultsView;
  /** Filtros compartilhados presentes na URL no momento da renderização no servidor. */
  filterQuery?: string;
};

const VIEWS: Array<{ id: ResultsView; label: string }> = [
  { id: "lista", label: "Lista" },
  { id: "mapa", label: "Mapa" },
  { id: "inteligencia", label: "Inteligência" }
];

export function resultsViewHref(searchId: string, view: ResultsView, filterQuery = "") {
  const params = new URLSearchParams(filterQuery);
  if (view !== "lista") params.set("view", view);
  const query = params.toString();
  return `/dashboard/search/${searchId}${query ? `?${query}` : ""}`;
}

/**
 * Alternância Lista / Mapa / Inteligência do resultado da busca. As três visões leem a
 * mesma busca salva (mesmos CNAEs, UF, município, situação, porte e datas) e os mesmos
 * filtros da URL (q, situacao, contato, uf, unidade): trocar de visão nunca refaz a
 * pesquisa na Casa dos Dados. Filtros alterados no cliente entram nos links na hora.
 */
export function ResultsViewToggle({ searchId, view, filterQuery = "" }: ResultsViewToggleProps) {
  const liveQuery = useSyncExternalStore(
    subscribeUrlParams,
    () => pickFilterQuery(window.location.search),
    () => filterQuery
  );

  return (
    <nav className="segmented" aria-label="Modo de visualização dos resultados">
      {VIEWS.map((item) => (
        <Link
          key={item.id}
          href={resultsViewHref(searchId, item.id, liveQuery)}
          className="segmented-item"
          aria-current={view === item.id ? "page" : undefined}
          scroll={false}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
