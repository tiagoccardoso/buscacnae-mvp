"use client";

import { useState } from "react";
import type { ResearchBrief } from "@/lib/prospecting/types";

export function ProspectingResearchButton({ establishmentId }: { establishmentId: string }) {
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function research() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/prospecting/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ establishmentId })
      });
      const payload = await response.json() as { brief?: ResearchBrief; error?: string };
      if (!response.ok || !payload.brief) throw new Error(payload.error ?? "Não foi possível pesquisar agora.");
      setBrief(payload.brief);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível pesquisar agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack-xs">
      <button type="button" className="button-ghost button-sm" onClick={research} disabled={loading} aria-busy={loading}>
        {loading ? "Pesquisando…" : "Pesquisa assistida"}
      </button>
      {error ? <span className="subtle" role="alert">{error}</span> : null}
      {brief ? (
        <div className="notice info stack-xs" role="status">
          <strong>{brief.summary}</strong>
          <span>{brief.commercialProfile.value}</span>
          <span className="footnote">Origem: {brief.commercialProfile.source} · confiança {brief.commercialProfile.confidence ?? "não informada"}</span>
          <details>
            <summary>Ver fatos e limitações</summary>
            <ul className="footnote">
              {brief.claims.map((claim) => <li key={claim.key}>{claim.key}: {claim.value} · {claim.source} · {claim.collectedAt}</li>)}
              {brief.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </details>
        </div>
      ) : null}
    </div>
  );
}
