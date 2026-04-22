"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ProcessingStatus = "idle" | "processing" | "ready" | "error";

type StatusPayload = {
  status?: ProcessingStatus;
  progress?: number | null;
  cursor?: number | null;
  totalChunks?: number | null;
  totalRecords?: number | null;
  startedAt?: string | null;
  lastHeartbeatAt?: string | null;
  stale?: boolean;
  etaSeconds?: number | null;
  error?: string | null;
  message?: string;
};

type AiFormatProcessingPanelProps = {
  searchId: string;
  initialStatus: ProcessingStatus;
  initialError?: string | null;
  autoStart?: boolean;
};

function clampPercentage(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatEta(etaSeconds: number | null | undefined) {
  if (typeof etaSeconds !== "number" || !Number.isFinite(etaSeconds) || etaSeconds <= 0) return null;
  if (etaSeconds < 60) return "menos de 1 min";

  const minutes = Math.round(etaSeconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}min` : `${hours}h`;
}

export function AiFormatProcessingPanel({ searchId, initialStatus, initialError, autoStart = false }: AiFormatProcessingPanelProps) {
  const router = useRouter();
  const [status, setStatus] = useState<ProcessingStatus>(initialStatus);
  const [message, setMessage] = useState<string>(initialError ?? "");
  const [loading, setLoading] = useState(false);
  const [statusData, setStatusData] = useState<StatusPayload | null>(null);
  const processInFlightRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    const response = await fetch(`/dashboard/search/${encodeURIComponent(searchId)}/format-ai/status`, {
      method: "GET",
      cache: "no-store"
    });

    const payload = (await response.json().catch(() => ({}))) as StatusPayload;

    if (!response.ok) {
      throw new Error(payload.error || payload.message || "Não foi possível consultar o status da preparação com IA.");
    }

    setStatusData(payload);

    if (payload.status) {
      setStatus(payload.status);
    }

    if (payload.error) {
      setMessage(payload.error);
    }

    if (payload.status === "ready") {
      router.refresh();
    }

    return payload;
  }, [router, searchId]);

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

      if (payload.status === "processing") {
        await fetchStatus().catch(() => undefined);
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
      await fetchStatus().catch(() => undefined);
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

  useEffect(() => {
    if (status !== "processing") {
      processInFlightRef.current = false;
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const payload = await fetchStatus();
        if (cancelled) return;

        if (payload.status !== "processing") {
          processInFlightRef.current = false;
          return;
        }

        if (!processInFlightRef.current) {
          processInFlightRef.current = true;
          try {
            const processResponse = await fetch(`/dashboard/search/${encodeURIComponent(searchId)}/format-ai/process`, {
              method: "POST",
              cache: "no-store"
            });
            const processPayload = (await processResponse.json().catch(() => ({}))) as { status?: ProcessingStatus; message?: string };
            if (processResponse.ok || processResponse.status === 202 || processResponse.status === 409) {
              if (processPayload.status) setStatus(processPayload.status);
              if (processPayload.status === "error" && processPayload.message) {
                setMessage(processPayload.message);
              }
            }
          } finally {
            processInFlightRef.current = false;
          }
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o status da preparação com IA.");
        }
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [fetchStatus, searchId, status]);

  const progress = useMemo(() => {
    if (status === "ready") return 100;
    return clampPercentage(statusData?.progress);
  }, [status, statusData?.progress]);

  const totalChunks = Math.max(0, Number(statusData?.totalChunks ?? 0));
  const cursor = Math.max(0, Number(statusData?.cursor ?? 0));
  const currentStep = status === "ready" ? totalChunks || 1 : Math.min(totalChunks || Math.max(cursor, 1), cursor + (status === "processing" ? 1 : 0));
  const etaLabel = formatEta(statusData?.etaSeconds);

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
            : "Estamos preparando sua lista com IA. Enquanto esta tela estiver aberta, o processamento continuará avançando."}
      </div>

      {status === "processing" ? (
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Processamento em andamento: {progress}%</div>
          <div style={{ fontSize: 13, color: "var(--muted-foreground, #666)" }}>
            Etapa {currentStep} de {Math.max(totalChunks, 1)}
            {typeof statusData?.totalRecords === "number" && statusData.totalRecords > 0 ? ` • ${statusData.totalRecords} registros` : ""}
            {etaLabel ? ` • ETA ~ ${etaLabel}` : ""}
          </div>
          <div
            aria-label="Progresso da preparação com IA"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            style={{
              width: "100%",
              height: 8,
              borderRadius: 999,
              background: "var(--border, #ddd)",
              overflow: "hidden"
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                background: "var(--primary, #111)",
                transition: "width 300ms ease"
              }}
            />
          </div>

          {statusData?.stale ? (
            <div className="notice warning" style={{ marginTop: 4 }}>
              Sem atualização recente do processamento. Tentaremos retomar automaticamente.
            </div>
          ) : null}
        </div>
      ) : null}

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
