"use client";

import { useEffect, useRef, useState } from "react";
import type { BusinessMapEngine, MapViewInfo } from "@/lib/map/engine/engine";
import type { PublicMapConfig } from "@/lib/map/engine/providers";

type BusinessMapCanvasProps = {
  config: PublicMapConfig;
  label: string;
  describedBy?: string;
  onReady(engine: BusinessMapEngine | null): void;
  onSelect(companyId: string | null): void;
  onViewChange(info: MapViewInfo): void;
  onGroupSelect(companyIds: string[]): void;
};

/**
 * Hospeda o viewer do Cesium. Criado uma única vez por montagem; os dados chegam
 * pela API do engine (sem recriar o viewer). No desmonte, aborta a inicialização
 * pendente e destrói viewer, handlers, listeners e timers (engine.destroy()).
 */
export default function BusinessMapCanvas({ config, label, describedBy, onReady, onSelect, onViewChange, onGroupSelect }: BusinessMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditsRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onSelect, onViewChange, onGroupSelect });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  // Mantém os callbacks mais recentes sem recriar o viewer.
  useEffect(() => {
    callbacks.current = { onReady, onSelect, onViewChange, onGroupSelect };
  });

  // A configuração pública é estável durante a sessão da página.
  const configKey = `${config.basemap}|${config.cesiumIonToken ? 1 : 0}|${config.googleMapTilesKey ? 1 : 0}`;

  useEffect(() => {
    const container = containerRef.current;
    const creditContainer = creditsRef.current;
    if (!container || !creditContainer) return;

    const controller = new AbortController();
    let engine: BusinessMapEngine | null = null;
    setStatus("loading");

    import("@/lib/map/engine/engine")
      .then(({ createBusinessMapEngine }) =>
        createBusinessMapEngine(
          {
            container,
            creditContainer,
            config,
            onSelect: (id) => callbacks.current.onSelect(id),
            onViewChange: (info) => callbacks.current.onViewChange(info),
            onGroupSelect: (ids) => callbacks.current.onGroupSelect(ids)
          },
          controller.signal
        )
      )
      .then((created) => {
        if (controller.signal.aborted) {
          created.destroy();
          return;
        }
        engine = created;
        setStatus("ready");
        callbacks.current.onReady(created);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[map] falha ao iniciar o mapa", error instanceof Error ? error.message : error);
        setStatus("error");
        callbacks.current.onReady(null);
      });

    return () => {
      controller.abort();
      callbacks.current.onReady(null);
      engine?.destroy();
      engine = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, attempt]);

  return (
    <div className="map-canvas-shell">
      <div
        ref={containerRef}
        className="map-canvas"
        role="application"
        aria-roledescription="mapa"
        aria-label={label}
        aria-describedby={describedBy}
        tabIndex={0}
      />
      <div ref={creditsRef} className="map-credits" />

      {status === "loading" ? (
        <div className="map-canvas-state" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>Preparando o mapa…</span>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="map-canvas-state" role="alert">
          <strong>Não foi possível exibir o mapa neste dispositivo.</strong>
          <span className="footnote">Verifique a conexão ou se o navegador tem aceleração gráfica (WebGL) ativa.</span>
          <button type="button" className="button-secondary button-sm" onClick={() => setAttempt((value) => value + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : null}
    </div>
  );
}
