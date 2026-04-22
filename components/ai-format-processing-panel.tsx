"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ProcessingStatus = "idle" | "processing" | "ready" | "error";

type AiFormatProcessingPanelProps = {
  searchId: string;
  initialStatus: ProcessingStatus;
  initialError?: string | null;
  autoStart?: boolean;
};

export function AiFormatProcessingPanel({ searchId, initialStatus, initialError, autoStart = false }: AiFormatProcessingPanelProps) {
  const router = useRouter();
  const [status, setStatus] = useState<ProcessingStatus>(initialStatus);
  const [message, setMessage] = useState<string>(initialError ?? "");
  const [loading, setLoading] = useState(false);

  async function start(force = false) {
    if (loading) return;
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`/dashboard/search/${encodeURIComponent(searchId)}/format-ai/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
        cache: "no-store"
      });

      const payload = (await response.json().catch(() => ({}))) as { status?: ProcessingStatus; message?: string };
      if (!response.ok && response.status !== 202 && response.status !== 409 && response.status !== 200) {
        throw new Error(payload.message || "Não foi possível iniciar o processamento com IA.");
      }

      if (payload.status) {
        setStatus(payload.status);
      }

      if (payload.message) {
        setMessage(payload.message);
      }

      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Erro ao iniciar o processamento com IA.");
    } finally {
      setLoading(false);
    }
  }

  async function processAndRefresh() {
    if (loading) return;
    setLoading(true);
    try {
      const response = await fetch(`/dashboard/search/${encodeURIComponent(searchId)}/format-ai/process`, {
        method: "POST",
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => ({}))) as { status?: ProcessingStatus; message?: string };
      if (!response.ok && response.status !== 202 && response.status !== 200 && response.status !== 409) {
        throw new Error(payload.message || "Não foi possível atualizar o processamento com IA.");
      }
      if (payload.status) setStatus(payload.status);
      if (payload.message) setMessage(payload.message);
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Erro ao atualizar o processamento com IA.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoStart && initialStatus === "idle") {
      void start(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, initialStatus]);

  if (status === "ready") {
    return null;
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className={`notice ${status === "error" ? "danger" : "warning"}`}>
        {status === "idle"
          ? "Sua lista com IA ainda não foi iniciada."
          : status === "error"
            ? message || "A preparação com IA falhou."
            : "Estamos preparando sua lista com IA. Você não precisa ficar nesta tela. Pode sair e voltar mais tarde."}
      </div>

      <div className="inline-actions">
        {status === "idle" ? (
          <button type="button" className="button" disabled={loading} onClick={() => start(false)}>
            {loading ? "Iniciando..." : "Iniciar preparação com IA"}
          </button>
        ) : null}

        {status === "error" ? (
          <button type="button" className="button" disabled={loading} onClick={() => start(true)}>
            {loading ? "Tentando novamente..." : "Tentar novamente"}
          </button>
        ) : null}

        {status === "processing" ? (
          <button type="button" className="button-ghost" disabled={loading} onClick={processAndRefresh}>
            {loading ? "Atualizando..." : "Atualizar status"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
