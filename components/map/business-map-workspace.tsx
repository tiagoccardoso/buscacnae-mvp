"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { BusinessMapEngine, MapLayerMode, MapViewInfo, SceneModeOption } from "@/lib/map/engine/engine";
import type { PublicMapConfig } from "@/lib/map/engine/providers";
import { VIEW_SCALE_LABELS } from "@/lib/map/geo";
import { PRECISION_LABELS, isPreciseLocation, type AreaSearchResponse, type MapCompany, type MapSearchOption } from "@/lib/map/types";
import { CompanyMapPanel } from "@/components/map/company-map-panel";
import { useMapSearchData } from "@/components/map/use-map-search-data";

// Cesium só existe no navegador: o canvas nunca é renderizado no servidor.
const BusinessMapCanvas = dynamic(() => import("@/components/map/business-map-canvas"), {
  ssr: false,
  loading: () => (
    <div className="map-canvas-shell">
      <div className="map-canvas-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <span>Preparando o mapa…</span>
      </div>
    </div>
  )
});

type BusinessMapWorkspaceProps = {
  searchId: string;
  config: PublicMapConfig;
  /** "page": /dashboard/mapa (com seletor de buscas). "embedded": aba Mapa do resultado da busca. */
  variant: "page" | "embedded";
  searchOptions?: MapSearchOption[];
};

const numberFormat = new Intl.NumberFormat("pt-BR");

function mapHref(variant: "page" | "embedded", searchId: string) {
  return variant === "page" ? `/dashboard/mapa?search=${searchId}` : `/dashboard/search/${searchId}?view=mapa`;
}

export function BusinessMapWorkspace({ searchId, config, variant, searchOptions = [] }: BusinessMapWorkspaceProps) {
  const router = useRouter();
  const hintId = useId();
  const { status, data, error, reload } = useMapSearchData(searchId);
  const fittedSearch = useRef<string | null>(null);
  // O engine é um objeto estável criado uma única vez pelo canvas.
  const [engine, setEngine] = useState<BusinessMapEngine | null>(null);
  const engineReady = Boolean(engine);
  const supportsPhotoreal = Boolean(engine?.supportsPhotorealistic);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [mode, setMode] = useState<MapLayerMode>("companies");
  const [sceneMode, setSceneMode] = useState<SceneModeOption>("3d");
  const [photoreal, setPhotoreal] = useState(false);
  const [view, setView] = useState<MapViewInfo | null>(null);
  const [movedSinceLoad, setMovedSinceLoad] = useState(false);
  const [areaStep, setAreaStep] = useState<"idle" | "confirm" | "running">("idle");
  const [areaMessage, setAreaMessage] = useState("");
  const [savedOverrides, setSavedOverrides] = useState<Record<string, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const areaController = useRef<AbortController | null>(null);

  const companies = useMemo<MapCompany[]>(() => {
    const list = data?.companies ?? [];
    if (Object.keys(savedOverrides).length === 0) return list;
    return list.map((company) => (company.id in savedOverrides ? { ...company, saved: savedOverrides[company.id] } : company));
  }, [data, savedOverrides]);

  const companiesById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const selected = selectedId ? companiesById.get(selectedId) ?? null : null;
  const groupCompanies = groupIds.map((id) => companiesById.get(id)).filter((item): item is MapCompany => Boolean(item));

  // Troca de busca: limpa seleção e estado local durante a renderização (padrão do React
  // para "resetar estado quando uma prop muda"); o viewer do Cesium é mantido.
  const [trackedSearchId, setTrackedSearchId] = useState(searchId);
  if (trackedSearchId !== searchId) {
    setTrackedSearchId(searchId);
    setSelectedId(null);
    setGroupIds([]);
    setSavedOverrides({});
    setAreaStep("idle");
    setAreaMessage("");
    setMovedSinceLoad(false);
  }

  // Dados → engine (sem recriar o viewer). Enquadra os resultados uma vez por busca.
  useEffect(() => {
    if (!engine || !data || data.searchId !== searchId) return;
    const shouldFit = fittedSearch.current !== searchId;
    engine.setCompanies(companies, { fit: shouldFit });
    if (shouldFit) {
      fittedSearch.current = searchId;
      setMovedSinceLoad(false);
    }
  }, [companies, data, engine, searchId]);

  useEffect(() => {
    engine?.setMode(mode);
  }, [mode, engine]);

  useEffect(() => {
    engine?.setSelected(selectedId);
  }, [selectedId, engine]);

  useEffect(() => () => areaController.current?.abort(), []);

  const handleReady = useCallback((next: BusinessMapEngine | null) => {
    setEngine(next);
    if (!next) fittedSearch.current = null;
  }, []);

  const handleSelect = useCallback((companyId: string | null) => {
    setSelectedId(companyId);
    setGroupIds([]);
  }, []);

  const handleGroupSelect = useCallback((companyIds: string[]) => {
    setSelectedId(null);
    setGroupIds(companyIds);
  }, []);

  const handleViewChange = useCallback((info: MapViewInfo) => {
    setView(info);
  }, []);

  // "Buscar nesta área" só aparece depois que o usuário mexe no mapa
  // (o enquadramento automático dos resultados não conta).
  const markUserInteraction = useCallback(() => setMovedSinceLoad(true), []);

  function focusCompany(companyId: string) {
    setSelectedId(companyId);
    engine?.focusCompany(companyId);
    setSheetOpen(false);
  }

  async function runAreaSearch() {
    if (!engine) return;
    areaController.current?.abort();
    const controller = new AbortController();
    areaController.current = controller;
    setAreaStep("running");
    setAreaMessage("");

    try {
      const response = await fetch("/api/map/area-search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ searchId, bounds: engine.getViewBounds() }),
        signal: controller.signal
      });
      const body = (await response.json().catch(() => null)) as AreaSearchResponse | null;
      if (controller.signal.aborted) return;
      if (body?.ok) {
        router.push(mapHref(variant, body.searchId));
        return;
      }
      setAreaStep("idle");
      setAreaMessage(body && !body.ok ? body.message : "Não foi possível buscar nesta área agora.");
    } catch {
      if (controller.signal.aborted) return;
      setAreaStep("idle");
      setAreaMessage("Não foi possível buscar nesta área agora. Tente novamente em instantes.");
    }
  }

  function changeSceneMode(next: SceneModeOption) {
    setSceneMode(next);
    engine?.setSceneMode(next);
  }

  async function togglePhotoreal() {
    if (!engine) return;
    const enabled = await engine.setPhotorealistic(!photoreal);
    setPhotoreal(enabled);
  }

  const stats = data?.stats;
  const approximateCount = stats ? stats.byPrecision.postal_code + stats.byPrecision.city + stats.byPrecision.approximate : 0;
  const visibleCompanies = (view?.visibleCompanyIds ?? []).map((id) => companiesById.get(id)).filter((item): item is MapCompany => Boolean(item));
  const isEmpty = status === "ready" && data && data.companies.length === 0;
  const noneLocated = status === "ready" && data && data.companies.length > 0 && data.stats.withLocation === 0;

  const renderSidebar = (prefix: string) => (
    <div className="map-sidebar-content">
      {variant === "page" && searchOptions.length > 0 ? (
        <div className="field">
          <label htmlFor={`${prefix}-search-select`} className="field-label">
            Busca exibida
          </label>
          <select
            id={`${prefix}-search-select`}
            className="input"
            value={searchId}
            onChange={(event) => router.push(mapHref("page", event.target.value))}
          >
            {searchOptions.some((option) => option.id === searchId) ? null : <option value={searchId}>Busca selecionada</option>}
            {searchOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.headline} · {numberFormat.format(option.totalResults)} empresas
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {data ? (
        <div className="stack-sm">
          {variant === "page" ? <h2 className="headline">{data.headline}</h2> : null}
          <p className="footnote">
            {data.cnaeText} · {data.locationText}
          </p>
          {data.filterLabels.length > 0 ? (
            <div className="inline-list" aria-label="Filtros aplicados">
              {data.filterLabels.map((label) => (
                <span key={label} className="pill">
                  {label}
                </span>
              ))}
            </div>
          ) : null}
          <div className="map-sidebar-links">
            <Link href={`/dashboard/search?reuse=${searchId}&view=mapa`} className="button-secondary button-sm">
              Editar filtros
            </Link>
            {variant === "page" ? (
              <Link href={`/dashboard/search/${searchId}`} className="button-ghost button-sm">
                Ver em lista
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {stats ? (
        <dl className="map-stats">
          <div>
            <dt>No mapa</dt>
            <dd className="numeric">{numberFormat.format(stats.withLocation)}</dd>
          </div>
          <div>
            <dt>Nesta área</dt>
            <dd className="numeric">{numberFormat.format(view?.visibleCompanyCount ?? 0)}</dd>
          </div>
          <div>
            <dt>Sem localização</dt>
            <dd className="numeric">{numberFormat.format(stats.withoutLocation)}</dd>
          </div>
        </dl>
      ) : null}

      <div className="stack-xs">
        <span className="field-label" id={`${prefix}-layer-label`}>
          Camada
        </span>
        <div className="segmented map-segmented" role="group" aria-labelledby={`${prefix}-layer-label`}>
          <button type="button" className="segmented-item" aria-pressed={mode === "companies"} aria-current={mode === "companies" ? "page" : undefined} onClick={() => setMode("companies")}>
            Empresas
          </button>
          <button type="button" className="segmented-item" aria-pressed={mode === "density"} aria-current={mode === "density" ? "page" : undefined} onClick={() => setMode("density")}>
            Densidade
          </button>
        </div>
      </div>

      {data && !data.unlocked ? (
        <div className="notice info">
          Você está vendo {data.companies.length} empresa de amostra.
          {data.lockedCount > 0 ? ` Os outros ${numberFormat.format(data.lockedCount)} registros aparecem no mapa após a compra da lista.` : ""}{" "}
          <Link href={`/dashboard/search/${searchId}`}>Ver opções de compra</Link>
        </div>
      ) : null}

      {data?.limits.tooManyResults ? (
        <div className="notice warning">
          Muitos resultados encontrados. Aproxime o mapa ou refine os filtros para visualizar as empresas.
          {data.limits.truncated ? ` Exibindo as primeiras ${numberFormat.format(data.limits.maxMarkers)}.` : ""}
        </div>
      ) : null}

      {data && approximateCount > 0 ? (
        <div className="notice info">
          Algumas empresas não possuem localização suficientemente precisa e aparecem no centro aproximado do município
          {data.stats.byPrecision.postal_code > 0 ? " ou do CEP" : ""}.
        </div>
      ) : null}

      {data && data.stats.withoutLocation > 0 ? (
        <p className="footnote">
          {numberFormat.format(data.stats.withoutLocation)} empresa(s) sem município identificável não aparecem no mapa, mas continuam na lista.
        </p>
      ) : null}

      <div className="map-legend" aria-label="Legenda do mapa">
        <span className="field-label">Legenda</span>
        <ul>
          <li>
            <span className="map-legend-swatch" data-variant="cluster" aria-hidden="true" /> Grupo de empresas (toque para aproximar)
          </li>
          <li>
            <span className="map-legend-swatch" data-variant="precise" aria-hidden="true" /> {PRECISION_LABELS.address}
          </li>
          <li>
            <span className="map-legend-swatch" data-variant="approximate" aria-hidden="true" /> Localização aproximada
          </li>
          {mode === "density" ? (
            <li>
              <span className="map-legend-swatch" data-variant="density" aria-hidden="true" /> Concentração de empresas
            </li>
          ) : null}
        </ul>
      </div>

      <section className="map-visible-list" aria-labelledby={`${prefix}-visible-title`}>
        <h3 id={`${prefix}-visible-title`} className="field-label">
          Empresas nesta área {view && view.visibleCompanyCount > visibleCompanies.length ? `(primeiras ${visibleCompanies.length})` : ""}
        </h3>
        {visibleCompanies.length === 0 ? (
          <p className="footnote">Nenhuma empresa na área visível.</p>
        ) : (
          <ul>
            {visibleCompanies.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  className="map-visible-item"
                  aria-current={company.id === selectedId ? "true" : undefined}
                  onClick={() => focusCompany(company.id)}
                >
                  <span className="map-visible-name">{company.displayName}</span>
                  <span className="footnote">
                    {[company.cityName, company.stateCode].filter(Boolean).join(" / ")}
                    {company.location && !isPreciseLocation(company.location.precision) ? " · aproximada" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return (
    <div className={`map-workspace map-workspace-${variant}`}>
      <aside className="map-sidebar" aria-label="Filtros e camadas do mapa">
        {renderSidebar("map-side")}
      </aside>

      <div className="map-stage" onPointerDown={markUserInteraction} onWheel={markUserInteraction} onKeyDown={markUserInteraction}>
        <BusinessMapCanvas
          config={config}
          label={data ? `Mapa empresarial: ${data.headline}` : "Mapa empresarial"}
          describedBy={hintId}
          onReady={handleReady}
          onSelect={handleSelect}
          onViewChange={handleViewChange}
          onGroupSelect={handleGroupSelect}
        />
        <p id={hintId} className="sr-only">
          Use as setas para mover o mapa, + e − para aproximar ou afastar e Esc para fechar o resumo. A lista “Empresas nesta área”
          no painel lateral traz as mesmas empresas em texto.
        </p>

        <div className="map-toolbar map-toolbar-top">
          <span className="map-chip glass" aria-live="polite">
            {view ? `Visão ${VIEW_SCALE_LABELS[view.scale].toLowerCase()}` : "Carregando"}
            {view ? ` · ${numberFormat.format(view.visibleCompanyCount)} nesta área` : ""}
          </span>
          <button type="button" className="map-chip glass map-sheet-toggle" onClick={() => setSheetOpen(true)} aria-expanded={sheetOpen} aria-controls="map-mobile-sheet">
            Filtros e camadas
          </button>
        </div>

        <div className="map-controls glass" role="toolbar" aria-label="Controles do mapa">
          <button type="button" className="map-control" onClick={() => engine?.zoomIn()} aria-label="Aproximar" title="Aproximar" disabled={!engineReady}>
            +
          </button>
          <button type="button" className="map-control" onClick={() => engine?.zoomOut()} aria-label="Afastar" title="Afastar" disabled={!engineReady}>
            −
          </button>
          <button type="button" className="map-control" onClick={() => engine?.fitToData()} aria-label="Enquadrar resultados" title="Enquadrar resultados" disabled={!engineReady}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
            </svg>
          </button>
          <button type="button" className="map-control" onClick={() => engine?.resetView()} aria-label="Ver o Brasil inteiro" title="Ver o Brasil inteiro" disabled={!engineReady}>
            BR
          </button>
          <button
            type="button"
            className="map-control"
            onClick={() => changeSceneMode(sceneMode === "3d" ? "2d" : "3d")}
            aria-label={sceneMode === "3d" ? "Mudar para mapa plano (2D)" : "Mudar para globo (3D)"}
            title={sceneMode === "3d" ? "Mapa plano (2D)" : "Globo (3D)"}
            disabled={!engineReady}
          >
            {sceneMode === "3d" ? "2D" : "3D"}
          </button>
          {engineReady && supportsPhotoreal ? (
            <button type="button" className="map-control" onClick={togglePhotoreal} aria-pressed={photoreal} aria-label="Relevo e edifícios 3D" title="Relevo e edifícios 3D">
              ⛰
            </button>
          ) : null}
        </div>

        {data && engineReady && (movedSinceLoad || areaStep !== "idle" || areaMessage) ? (
          <div className="map-area-search">
            {areaStep === "confirm" ? (
              <div className="map-area-confirm glass-thick" role="dialog" aria-label="Confirmar busca nesta área">
                <p className="footnote">
                  Vamos buscar os mesmos CNAEs e filtros nos municípios da área visível. A nova busca fica salva no histórico e segue a
                  mesma regra de compra da lista.
                </p>
                <div className="cluster">
                  <button type="button" className="button button-sm" onClick={runAreaSearch}>
                    Buscar
                  </button>
                  <button type="button" className="button-ghost button-sm" onClick={() => setAreaStep("idle")}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="button button-sm map-area-button"
                onClick={() => {
                  setAreaMessage("");
                  setAreaStep("confirm");
                }}
                aria-busy={areaStep === "running" || undefined}
                disabled={areaStep === "running"}
              >
                {areaStep === "running" ? "Buscando nesta área…" : "Buscar nesta área"}
              </button>
            )}
            {areaMessage ? (
              <p className="map-area-message glass" role="status">
                {areaMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        {status === "loading" && !data ? (
          <div className="map-overlay-state glass" role="status">
            <span className="spinner" aria-hidden="true" /> Carregando empresas…
          </div>
        ) : null}
        {status === "loading" && data ? (
          <div className="map-overlay-state map-overlay-compact glass" role="status">
            <span className="spinner" aria-hidden="true" /> Atualizando…
          </div>
        ) : null}
        {status === "error" ? (
          <div className="map-overlay-state glass" role="alert">
            <span>{error}</span>
            <button type="button" className="button-secondary button-sm" onClick={reload}>
              Tentar novamente
            </button>
          </div>
        ) : null}
        {isEmpty ? (
          <div className="map-overlay-state glass" role="status">
            <strong>Nenhuma empresa encontrada nesta região.</strong>
            <span className="footnote">Ajuste os filtros ou mova o mapa e use “Buscar nesta área”.</span>
          </div>
        ) : null}
        {noneLocated ? (
          <div className="map-overlay-state glass" role="status">
            <strong>As empresas desta busca não têm localização suficiente para o mapa.</strong>
            <Link href={`/dashboard/search/${searchId}`} className="button-secondary button-sm">
              Ver em lista
            </Link>
          </div>
        ) : null}

        {groupCompanies.length > 0 && !selected ? (
          <section className="map-company-panel glass-thick" aria-labelledby="map-group-title">
            <div className="map-company-panel-head">
              <div className="stack-xs">
                <span className="eyebrow">Mesmo local</span>
                <h3 id="map-group-title" className="title-3">
                  {numberFormat.format(groupCompanies.length)} empresas neste ponto
                </h3>
              </div>
              <button type="button" className="button-icon" onClick={() => setGroupIds([])} aria-label="Fechar lista de empresas">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </div>
            <ul className="map-group-list">
              {groupCompanies.map((company) => (
                <li key={company.id}>
                  <button type="button" className="map-visible-item" onClick={() => handleSelect(company.id)}>
                    <span className="map-visible-name">{company.displayName}</span>
                    <span className="footnote">{company.status ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {selected ? (
          <CompanyMapPanel
            key={selected.id}
            company={selected}
            searchId={searchId}
            onClose={() => setSelectedId(null)}
            onSavedChange={(companyId, saved) => setSavedOverrides((current) => ({ ...current, [companyId]: saved }))}
          />
        ) : null}
      </div>

      {sheetOpen ? (
        <div className="map-sheet-backdrop" onClick={() => setSheetOpen(false)} aria-hidden="true" />
      ) : null}
      <div
        id="map-mobile-sheet"
        className={`map-sheet glass-thick${sheetOpen ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Filtros e camadas"
        hidden={!sheetOpen}
      >
        <div className="map-sheet-head">
          <span className="headline">Filtros e camadas</span>
          <button type="button" className="button-ghost button-sm" onClick={() => setSheetOpen(false)}>
            Fechar
          </button>
        </div>
        {sheetOpen ? renderSidebar("map-sheet") : null}
      </div>
    </div>
  );
}
