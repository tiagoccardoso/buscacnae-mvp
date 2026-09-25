"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { PublicMapConfig } from "@/lib/map/config";
import type { BusinessMapEngine, MapEngineCallbacks, MapEngineFactory } from "@/lib/map/engine-contract";
import type { GeoBounds, MapEngineKind } from "@/lib/map/types";

type BusinessMapCanvasProps = MapEngineCallbacks & {
  kind: MapEngineKind;
  config: PublicMapConfig;
  label: string;
  describedBy?: string;
  /** Área inicial (ex.: a que o usuário via no outro motor). Lida só na criação. */
  initialBounds?: GeoBounds | null;
  onReady(engine: BusinessMapEngine | null): void;
};

/**
 * Cada motor é um chunk separado, carregado sob demanda:
 * - 2D: MapLibre GL + deck.gl (padrão);
 * - 3D: CesiumJS (só quando o usuário pede o globo).
 */
const ENGINE_LOADERS: Record<MapEngineKind, () => Promise<MapEngineFactory>> = {
  "2d": () => import("@/lib/map/maplibre/engine").then((module) => module.createMapLibreEngine),
  "3d": () => import("@/lib/map/cesium/engine").then((module) => module.createCesiumEngine)
};

const LOADING_LABEL: Record<MapEngineKind, string> = {
  "2d": "Preparando o mapa…",
  "3d": "Preparando o globo 3D…"
};

/**
 * Hospeda o motor do mapa. Criado uma única vez por montagem (e por troca 2D/3D); os
 * dados chegam pela API do motor. No desmonte, aborta a inicialização pendente e
 * destrói mapa, overlays, handlers, listeners e timers (engine.destroy()).
 */
export default function BusinessMapCanvas({
  kind,
  config,
  label,
  describedBy,
  initialBounds,
  onReady,
  onSelect,
  onViewChange,
  onGroupSelect,
  onRegionSelect,
  onUserMove
}: BusinessMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditsRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onSelect, onViewChange, onGroupSelect, onRegionSelect, onUserMove });
  const initialBoundsRef = useRef(initialBounds ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  // Mantém os callbacks mais recentes sem recriar o motor.
  useEffect(() => {
    callbacks.current = { onReady, onSelect, onViewChange, onGroupSelect, onRegionSelect, onUserMove };
  });

  // A configuração pública é estável durante a sessão da página.
  const configKey = `${config.basemap}|${config.styleUrl}|${config.cesiumIonToken ? 1 : 0}|${config.googleMapTilesKey ? 1 : 0}`;

  useEffect(() => {
    const container = containerRef.current;
    const creditContainer = creditsRef.current;
    if (!container || !creditContainer) return;

    const controller = new AbortController();
    let engine: BusinessMapEngine | null = null;
    setStatus("loading");

    ENGINE_LOADERS[kind]()
      .then((factory) =>
        factory(
          {
            container,
            creditContainer,
            config,
            initialBounds: initialBoundsRef.current,
            onSelect: (id) => callbacks.current.onSelect(id),
            onViewChange: (info) => callbacks.current.onViewChange(info),
            onGroupSelect: (ids) => callbacks.current.onGroupSelect(ids),
            onRegionSelect: (region) => callbacks.current.onRegionSelect(region),
            onUserMove: () => callbacks.current.onUserMove?.()
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
  }, [configKey, attempt, kind]);

  return (
    <div className={`map-canvas-shell map-engine-${kind}`}>
      <div
        ref={containerRef}
        className="map-canvas"
        role="application"
        aria-roledescription={kind === "3d" ? "globo 3D" : "mapa"}
        aria-label={label}
        aria-describedby={describedBy}
        tabIndex={0}
      />
      <div ref={creditsRef} className="map-credits" hidden={kind !== "3d"} />

      {status === "loading" ? (
        <div className="map-canvas-state" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{LOADING_LABEL[kind]}</span>
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
