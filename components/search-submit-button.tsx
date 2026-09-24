"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ProgressBar } from "@/components/ui/progress-bar";

type SearchSubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
};

/**
 * Botão de envio da busca (home e dashboard). Mostra estado de carregamento,
 * tempo decorrido e progresso estimado enquanto o server action executa.
 */
export function SearchSubmitButton({ idleLabel, pendingLabel }: SearchSubmitButtonProps) {
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
    <div className="search-submit-main">
      <button type="submit" className="button button-lg" disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : idleLabel}
      </button>

      {pending ? (
        <div className="stack-xs" aria-live="polite">
          <ProgressBar value={progress} label="Progresso da busca" />
          <div className="progress-meta">
            <span>Processando sua busca</span>
            <span>{elapsedSeconds}s</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
