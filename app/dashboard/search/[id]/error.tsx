"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function SearchResultError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Apenas o digest: a mensagem técnica não é exibida ao usuário.
    console.error("[search-result]", { digest: error.digest ?? null });
  }, [error]);

  return (
    <section className="section" aria-labelledby="search-error-title">
      <div className="notice danger" role="alert">
        <div className="stack-xs">
          <strong id="search-error-title">Não foi possível abrir esta busca agora.</strong>
          <span>Os resultados continuam salvos. Tente novamente em instantes.</span>
        </div>
      </div>
      <div className="cluster">
        <button type="button" className="button" onClick={reset}>
          Tentar novamente
        </button>
        <Link href="/dashboard/history" className="button-ghost">
          Ver histórico
        </Link>
      </div>
    </section>
  );
}
