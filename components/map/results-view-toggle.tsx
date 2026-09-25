import Link from "next/link";

type ResultsViewToggleProps = {
  searchId: string;
  view: "lista" | "mapa";
};

/**
 * Alternância Lista / Mapa do resultado da busca. As duas visões leem a mesma busca
 * salva (mesmos CNAEs, UF, município, situação, porte, data de abertura e filtros),
 * então trocar de visão nunca exige refazer a pesquisa.
 */
export function ResultsViewToggle({ searchId, view }: ResultsViewToggleProps) {
  return (
    <nav className="segmented" aria-label="Modo de visualização dos resultados">
      <Link
        href={`/dashboard/search/${searchId}`}
        className="segmented-item"
        aria-current={view === "lista" ? "page" : undefined}
        scroll={false}
      >
        Lista
      </Link>
      <Link
        href={`/dashboard/search/${searchId}?view=mapa`}
        className="segmented-item"
        aria-current={view === "mapa" ? "page" : undefined}
        scroll={false}
      >
        Mapa
      </Link>
    </nav>
  );
}
