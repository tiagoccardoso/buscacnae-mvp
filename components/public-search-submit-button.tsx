"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export function PublicSearchSubmitButton() {
  const { pending } = useFormStatus();
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pending) {
      setProgress(0);
      setElapsedSeconds(0);
      startedAtRef.current = null;
      return;
    }

    if (!startedAtRef.current) startedAtRef.current = Date.now();

    const interval = window.setInterval(() => {
      const startedAt = startedAtRef.current ?? Date.now();
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setElapsedSeconds(elapsed);
      setProgress((prev) => {
        if (prev >= 92) return prev;
        const next = prev + Math.max(1, Math.round((92 - prev) * 0.08));
        return Math.min(92, next);
      });
    }, 400);

    return () => window.clearInterval(interval);
  }, [pending]);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <button type="submit" className="button button-lg" disabled={pending} aria-disabled={pending}>
        {pending ? "Pesquisando e calculando o valor da lista..." : "Ver volume e valor da lista"}
      </button>

      {pending ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Processando sua busca ({elapsedSeconds}s). Isso pode levar alguns instantes.
          </div>
          <div
            role="progressbar"
            aria-label="Progresso da busca"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}
          >
            <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg, #9f7aea, #22d3ee)", transition: "width 300ms ease" }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
