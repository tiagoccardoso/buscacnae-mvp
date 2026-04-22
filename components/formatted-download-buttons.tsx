"use client";

import { useEffect, useRef, useState } from "react";

type DownloadKind = "xlsx" | "pdf";

type DownloadStatus = {
  type: "idle" | "processing" | "success" | "error";
  text: string;
};

type FormattedDownloadButtonsProps = {
  searchId: string;
};

function readFilenameFromDisposition(value: string | null, fallback: string) {
  if (!value) return fallback;

  const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim());
    } catch {
      return utfMatch[1].trim();
    }
  }

  const basicMatch = value.match(/filename="?([^";]+)"?/i);
  if (basicMatch?.[1]) {
    return basicMatch[1].trim();
  }

  return fallback;
}

export function FormattedDownloadButtons({ searchId }: FormattedDownloadButtonsProps) {
  const [activeKind, setActiveKind] = useState<DownloadKind | null>(null);
  const [status, setStatus] = useState<DownloadStatus>({ type: "idle", text: "" });
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleDownload(kind: DownloadKind) {
    const label = kind === "xlsx" ? "XLSX pronto para prospecção" : "PDF legível por registro";
    setActiveKind(kind);
    setStatus({
      type: "processing",
      text: `Preparando download de ${label}...`
    });

    try {
      const response = await fetch(`/dashboard/search/${encodeURIComponent(searchId)}/format-ai/download/${kind}`, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        let errorText = "";
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as { message?: string };
          errorText = typeof payload?.message === "string" ? payload.message.trim() : "";
        } else {
          errorText = (await response.text()).trim();
        }

        if (response.status === 409) {
          throw new Error(errorText || "A formatação com IA ainda está em processamento. Volte em alguns minutos.");
        }

        throw new Error(errorText || `Não foi possível gerar o ${label.toLowerCase()}.`);
      }

      const blob = await response.blob();
      const filename = readFilenameFromDisposition(
        response.headers.get("content-disposition"),
        `lista-pronta-prospeccao-ia.${kind}`
      );

      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
      }, 2000);

      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }

      setStatus({
        type: "success",
        text: `${label} concluído. O download começou automaticamente.`
      });

      resetTimerRef.current = window.setTimeout(() => {
        setStatus({ type: "idle", text: "" });
      }, 5000);
    } catch (error) {
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : `Não foi possível gerar o ${label.toLowerCase()}.`
      });
    } finally {
      setActiveKind(null);
    }
  }

  const isProcessing = activeKind !== null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="inline-actions">
        <button
          type="button"
          className="button"
          disabled={isProcessing}
          onClick={() => handleDownload("xlsx")}
          aria-busy={activeKind === "xlsx"}
        >
          {activeKind === "xlsx" ? "Processando XLSX..." : "Baixar XLSX com Contatos WhatsApp"}
        </button>
        <button
          type="button"
          className="button-ghost"
          disabled={isProcessing}
          onClick={() => handleDownload("pdf")}
          aria-busy={activeKind === "pdf"}
        >
          {activeKind === "pdf" ? "Processando PDF..." : "Baixar PDF legível por registro"}
        </button>
      </div>

      {status.type !== "idle" ? (
        <div className={`notice ${status.type === "error" ? "danger" : status.type === "success" ? "success" : "warning"}`}>
          {status.text}
        </div>
      ) : null}
    </div>
  );
}
