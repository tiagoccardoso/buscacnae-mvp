"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PublicMapConfig } from "@/lib/map/config";
import type { BusinessMapEngine, MapViewInfo } from "@/lib/map/engine-contract";
import { filterIndexedMapCompanies, indexMapCompanies, listMapStates } from "@/lib/map/filters";
import { VIEW_SCALE_LABELS } from "@/lib/map/geo";
import { aggregateByMunicipality, summarizeCompanies } from "@/lib/map/intelligence/region-stats";
import {
  MAP_LAYER_LABELS,
  MAP_LAYER_PARAM,
  PRECISION_LABELS,
  isPreciseLocation,
  type AreaSearchResponse,
  type GeoBounds,
  type MapCompany,
  type MapEngineKind,
  type MapLayerMode,
  type MapRegionSelection,
  type MapSearchData,
  type MapSearchOption
} from "@/lib/map/types";
import { DEFAULT_COMPANY_TABLE_FILTERS, hasActiveFilters, type CompanyTableFilters } from "@/lib/results/company-table-model";
import { pickFilterQuery, replaceUrlParams, writeCompanyFilters } from "@/lib/results/filter-params";
import { CompanyMapPanel } from "@/components/map/company-map-panel";
import { MapFilters } from "@/components/map/map-filters";
import { RegionInsights } from "@/components/map/region-insights";
import { useMapSearchData } from "@/components/map/use-map-search-data";

// Os motores (MapLibre/deck.gl e Cesium) só existem no navegador.
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

export type MapWorkspaceView = "mapa" | "inteligencia";

export type MapWorkspaceInitialState = {
  filters?: CompanyTableFilters;
  layer?: MapLayerMode | null;
  companyId?: string | null;
};

type BusinessMapWorkspaceProps = {
  searchId: string;
  config: PublicMapConfig;
  /** "page": /dashboard/mapa (com seletor de buscas). "embedded": abas do resultado da busca. */
  variant: "page" | "embedded";
  view?: MapWorkspaceView;
  searchOptions?: MapSearchOption[];
  initialState?: MapWorkspaceInitialState;
  /** Dados já prontos (testes). */
  staticData?: MapSearchData | null;
  /** Endpoint alternativo de dados (somente o ambiente local de validação: /dev/mapa). */
  dataEndpoint?: string | null;
};

const numberFormat = new Intl.NumberFormat("pt-BR");

function defaultLayer(view: MapWorkspaceView): MapLayerMode {
  return view === "inteligencia" ? "concentration" : "companies";
}

function workspaceHref(variant: "page" | "embedded", searchId: string, view: MapWorkspaceView) {
  const filters = pickFilterQuery(typeof window === "undefined" ? "" : window.location.search);
  if (variant === "page") {
    const params = new URLSearchParams(filters);
    params.set("search", searchId);
    if (view === "inteligencia") params.set("view", view);
    return `/dashboard/mapa?${params.toString()}`;
  }
  const params = new URLSearchParams(filters);
  params.set("view", view);
  return `/dashboard/search/${searchId}?${params.toString()}`;
}

export function BusinessMapWorkspace({
  searchId,
  config,
  variant,
  view = "mapa",
  searchOptions = [],
  initialState,
  staticData = null,
  dataEndpoint = null
}: BusinessMapWorkspaceProps) {
  const router = useRouter();
  const hintId = useId();
  const { status, data, error, reload } = useMapSearchData(searchId, { staticData, endpoint: dataEndpoint });

  const [engine, setEngine] = useState<BusinessMapEngine | null>(null);
  const [engineKind, setEngineKind] = useState<MapEngineKind>("2d");
  const [handoffBounds, setHandoffBounds] = useState<GeoBounds | null>(null);
  const [mode, setMode] = useState<MapLayerMode>(initialState?.layer ?? defaultLayer(view));
  const [filters, setFilters] = useState<CompanyTableFilters>(initialState?.filters ?? DEFAULT_COMPANY_TABLE_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(initialState?.companyId ?? null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [region, setRegion] = useState<MapRegionSelection | null>(null);
  const [viewInfo, setViewInfo] = useState<MapViewInfo | null>(null);
  const [movedSinceLoad, setMovedSinceLoad] = useState(false);
  const [areaStep, setAreaStep] = useState<"idle" | "confirm" | "running">("idle");
  const [areaMessage, setAreaMessage] = useState("");
  const [savedOverrides, setSavedOverrides] = useState<Record<string, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [photoreal, setPhotoreal] = useState(false);
  const areaController = useRef<AbortController | null>(null);
  // Enquadramento automático: uma vez por busca (trocar 2D/3D mantém a área vista).
  const framedSearch = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(initialState?.companyId ?? null);

  // Troca de busca: limpa seleção e estado local durante a renderização.
  const [trackedSearchId, setTrackedSearchId] = useState(searchId);
  if (trackedSearchId !== searchId) {
    setTrackedSearchId(searchId);
    setSelectedId(null);
    setGroupIds([]);
    setRegion(null);
    setSavedOverrides({});
    setAreaStep("idle");
    setAreaMessage("");
    setMovedSinceLoad(false);
  }

  // Modelo único (MapCompany) com o estado "salvo" atualizado nesta sessão.
  const companies = useMemo<MapCompany[]>(() => {
    const list = data?.companies ?? [];
    if (Object.keys(savedOverrides).length === 0) return list;
    return list.map((company) => (company.id in savedOverrides ? { ...company, saved: savedOverrides[company.id] } : company));
  }, [data, savedOverrides]);

  // Filtros = mesmas regras da Lista. A busca textual é adiada para não travar a digitação.
  const indexed = useMemo(() => indexMapCompanies(companies), [companies]);
  const deferredQuery = useDeferredValue(filters.query);
  const effectiveFilters = useMemo(() => ({ ...filters, query: deferredQuery }), [filters, deferredQuery]);
  const filtered = useMemo(() => filterIndexedMapCompanies(indexed, effectiveFilters), [indexed, effectiveFilters]);
  const states = useMemo(() => listMapStates(companies), [companies]);
  const hasBranchData = useMemo(() => companies.some((company) => company.headquartersOrBranch !== null), [companies]);
  const filtersActive = hasActiveFilters(filters);

  const companiesById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const filteredIds = useMemo(() => new Set(filtered.map((company) => company.id)), [filtered]);
  const selected = selectedId ? companiesById.get(selectedId) ?? null : null;
  const groupCompanies = groupIds.map((id) => companiesById.get(id)).filter((item): item is MapCompany => Boolean(item));

  const capabilities = engine?.capabilities;
  const supportedModes = capabilities?.modes ?? (engineKind === "3d" ? ["companies", "concentration"] : ["companies", "concentration", "regions"]);
  const effectiveMode: MapLayerMode = supportedModes.includes(mode) ? mode : "companies";

  // Estado compartilhável na URL (filtros, camada, empresa), sem navegar.
  useEffect(() => {
    replaceUrlParams((params) => {
      writeCompanyFilters(params, filters);
      if (mode === defaultLayer(view)) params.delete("camada");
      else params.set("camada", MAP_LAYER_PARAM[mode]);
      if (selectedId) params.set("empresa", selectedId);
      else params.delete("empresa");
    });
  }, [filters, mode, selectedId, view]);

  // Dados filtrados → motor (sem recriar o mapa).
  useEffect(() => {
    if (!engine || !data || data.searchId !== searchId) return;
    const firstFrame = framedSearch.current !== searchId;
    const focusId = firstFrame ? pendingFocus.current : null;
    const focusCompany = focusId ? companiesById.get(focusId) : null;
    engine.setData({ companies: filtered, regions: data.regions }, { fit: firstFrame && !focusCompany?.location });
    if (firstFrame) {
      framedSearch.current = searchId;
      pendingFocus.current = null;
      if (focusCompany?.location) engine.focusCompany(focusCompany.id);
    }
  }, [companiesById, data, engine, filtered, searchId]);

  useEffect(() => {
    engine?.setMode(effectiveMode);
  }, [effectiveMode, engine]);

  useEffect(() => {
    engine?.setSelected(selectedId);
  }, [selectedId, engine]);

  useEffect(() => {
    engine?.setSelectedRegion(region?.id ?? null);
  }, [region, engine]);

  useEffect(() => () => areaController.current?.abort(), []);

  const handleReady = useCallback((next: BusinessMapEngine | null) => {
    setEngine(next);
    if (next) setPhotoreal(false);
  }, []);

  const handleSelect = useCallback((companyId: string | null) => {
    setSelectedId(companyId);
    setGroupIds([]);
    if (companyId) setRegion(null);
  }, []);

  const handleGroupSelect = useCallback((companyIds: string[]) => {
    setSelectedId(null);
    setRegion(null);
    setGroupIds(companyIds);
  }, []);

  const handleRegionSelect = useCallback((next: MapRegionSelection | null) => {
    setRegion(next);
    if (next) {
      setSelectedId(null);
      setGroupIds([]);
    }
  }, []);

  const handleViewChange = useCallback((info: MapViewInfo) => setViewInfo(info), []);
  // "Buscar nesta área" só aparece depois que o usuário mexe no mapa.
  const handleUserMove = useCallback(() => setMovedSinceLoad(true), []);

  function changeMode(next: MapLayerMode) {
    setMode(next);
    setRegion(null);
  }

  function focusCompany(companyId: string) {
    setSelectedId(companyId);
    setRegion(null);
    engine?.focusCompany(companyId);
    setSheetOpen(false);
  }

  function switchEngine(next: MapEngineKind) {
    if (next === engineKind) return;
    setHandoffBounds(engine?.getViewBounds() ?? viewInfo?.bounds ?? data?.bounds ?? null);
    setEngine(null);
    setEngineKind(next);
    setRegion(null);
  }

  async function togglePhotoreal() {
    if (!engine) return;
    setPhotoreal(await engine.setPhotorealistic(!photoreal));
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
        router.push(workspaceHref(variant, body.searchId, view));
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

  // ------------------------------------------------------------------ derivados
  const stats = data?.stats;
  const approximateCount = stats ? stats.byPrecision.postal_code + stats.byPrecision.city + stats.byPrecision.approximate : 0;
  const visibleCompanies = (viewInfo?.visibleCompanyIds ?? [])
    .map((id) => companiesById.get(id))
    .filter((item): item is MapCompany => Boolean(item));
  const isEmpty = status === "ready" && data && data.companies.length === 0;
  const noneLocated = status === "ready" && data && data.companies.length > 0 && data.stats.withLocation === 0;
  const filteredOut = status === "ready" && data && data.companies.length > 0 && filtered.length === 0;

  const regionCompanies = useMemo(
    () => (region ? region.companyIds.map((id) => companiesById.get(id)).filter((item): item is MapCompany => Boolean(item && filteredIds.has(item.id))) : []),
    [companiesById, filteredIds, region]
  );
  const regionStats = useMemo(() => (region ? summarizeCompanies(regionCompanies) : null), [region, regionCompanies]);
  const datasetStats = useMemo(() => (view === "inteligencia" ? summarizeCompanies(filtered) : null), [filtered, view]);
  const topMunicipalities = useMemo(
    () => (view === "inteligencia" && data ? aggregateByMunicipality(filtered, data.regions).regions.slice(0, 8) : []),
    [data, filtered, view]
  );

  function selectMunicipality(key: string) {
    const aggregate = topMunicipalities.find((item) => item.seat.key === key);
    if (!aggregate) return;
    setRegion({
      kind: "municipality",
      id: aggregate.seat.key,
      name: aggregate.seat.name,
      stateCode: aggregate.seat.stateCode,
      companyIds: aggregate.companyIds,
      latitude: aggregate.seat.latitude,
      longitude: aggregate.seat.longitude
    });
    setSelectedId(null);
    setGroupIds([]);
    engine?.focusPoint(aggregate.seat.latitude, aggregate.seat.longitude, 10);
    setSheetOpen(false);
  }

  const regionTitle =
    region?.kind === "municipality"
      ? `${region.name}/${region.stateCode}`
      : region
        ? `Célula H3 · resolução ${region.resolution}`
        : "";

  const legend = viewInfo?.legend ?? null;

  // ------------------------------------------------------------------ painel lateral
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
            onChange={(event) => router.push(workspaceHref("page", event.target.value, view))}
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
            <div className="inline-list" aria-label="Filtros da busca">
              {data.filterLabels.map((label) => (
                <span key={label} className="pill">
                  {label}
                </span>
              ))}
            </div>
          ) : null}
          <div className="map-sidebar-links">
            <Link href={`/dashboard/search?reuse=${searchId}&view=mapa`} className="button-secondary button-sm">
              Editar busca
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
            <dd className="numeric">{numberFormat.format(filtered.filter((company) => company.location).length)}</dd>
          </div>
          <div>
            <dt>Nesta área</dt>
            <dd className="numeric">{numberFormat.format(viewInfo?.visibleCompanyCount ?? 0)}</dd>
          </div>
          <div>
            <dt>Sem localização</dt>
            <dd className="numeric">{numberFormat.format(filtered.filter((company) => !company.location).length)}</dd>
          </div>
        </dl>
      ) : null}

      <MapFilters
        idPrefix={prefix}
        filters={filters}
        states={states}
        hasBranchData={hasBranchData}
        onChange={setFilters}
        resultCount={filtered.length}
        totalCount={companies.length}
        active={filtersActive}
      />

      <div className="stack-xs">
        <span className="field-label" id={`${prefix}-layer-label`}>
          Camada
        </span>
        <div className="segmented map-segmented" role="group" aria-labelledby={`${prefix}-layer-label`}>
          {(["companies", "concentration", "regions"] as const).map((item) => {
            const supported = supportedModes.includes(item);
            return (
              <button
                key={item}
                type="button"
                className="segmented-item"
                aria-pressed={effectiveMode === item}
                disabled={!supported}
                title={supported ? undefined : "Disponível no mapa 2D"}
                onClick={() => changeMode(item)}
              >
                {MAP_LAYER_LABELS[item]}
              </button>
            );
          })}
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
          {numberFormat.format(approximateCount)} empresa(s) sem endereço geolocalizado aparecem em volta do centro do município
          {data.stats.byPrecision.postal_code > 0 ? " ou do CEP" : ""}, com marcador vazado. O ponto não indica o endereço exato.
        </div>
      ) : null}

      {data && data.stats.withoutLocation > 0 ? (
        <p className="footnote">
          {numberFormat.format(data.stats.withoutLocation)} empresa(s) sem município identificável não aparecem no mapa, mas continuam na lista.
        </p>
      ) : null}

      {view === "inteligencia" && datasetStats ? (
        <section className="stack-sm" aria-labelledby={`${prefix}-overview-title`}>
          <h3 id={`${prefix}-overview-title`} className="headline">
            Panorama {filtersActive ? "do recorte filtrado" : "da busca"}
          </h3>
          <RegionInsights stats={datasetStats} scopeLabel="na busca" />
          {topMunicipalities.length > 0 ? (
            <div className="stack-xs">
              <h4 className="field-label">Municípios com mais empresas</h4>
              <ol className="map-ranking">
                {topMunicipalities.map((item) => (
                  <li key={item.seat.key}>
                    <button
                      type="button"
                      className="map-visible-item"
                      aria-current={region?.id === item.seat.key ? "true" : undefined}
                      onClick={() => selectMunicipality(item.seat.key)}
                    >
                      <span className="map-visible-name">
                        {item.seat.name}/{item.seat.stateCode}
                      </span>
                      <span className="numeric footnote">{numberFormat.format(item.count)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>
      ) : null}

      <MapLegendBlock mode={effectiveMode} legend={legend} />

      {view === "mapa" ? (
        <section className="map-visible-list" aria-labelledby={`${prefix}-visible-title`}>
          <h3 id={`${prefix}-visible-title`} className="field-label">
            Empresas nesta área{" "}
            {viewInfo && viewInfo.visibleCompanyCount > visibleCompanies.length ? `(primeiras ${visibleCompanies.length})` : ""}
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
      ) : null}
    </div>
  );

  return (
    <div className={`map-workspace map-workspace-${variant} map-view-${view}`}>
      <aside className="map-sidebar" aria-label="Filtros, camadas e análise do mapa">
        {renderSidebar("map-side")}
      </aside>

      <div className="map-stage">
        <BusinessMapCanvas
          key={engineKind}
          kind={engineKind}
          config={config}
          initialBounds={handoffBounds}
          label={data ? `Mapa empresarial: ${data.headline}` : "Mapa empresarial"}
          describedBy={hintId}
          onReady={handleReady}
          onSelect={handleSelect}
          onViewChange={handleViewChange}
          onGroupSelect={handleGroupSelect}
          onRegionSelect={handleRegionSelect}
          onUserMove={handleUserMove}
        />
        <p id={hintId} className="sr-only">
          Use as setas para mover o mapa, + e − para aproximar ou afastar e Esc para fechar o resumo. O painel lateral traz as mesmas
          empresas e indicadores em texto.
        </p>

        <div className="map-toolbar map-toolbar-top">
          <span className="map-chip glass" aria-live="polite">
            {viewInfo ? `Visão ${viewInfo.scale === "pais" ? VIEW_SCALE_LABELS.pais : VIEW_SCALE_LABELS[viewInfo.scale].toLowerCase()}` : "Carregando"}
            {viewInfo ? ` · ${numberFormat.format(viewInfo.visibleCompanyCount)} nesta área` : ""}
          </span>
          <button
            type="button"
            className="map-chip glass map-sheet-toggle"
            onClick={() => setSheetOpen(true)}
            aria-expanded={sheetOpen}
            aria-controls="map-mobile-sheet"
          >
            {view === "inteligencia" ? "Filtros e análise" : "Filtros e camadas"}
            {filtersActive ? " •" : ""}
          </button>
        </div>

        <div className="map-controls glass" role="toolbar" aria-label="Controles do mapa">
          <button type="button" className="map-control" onClick={() => engine?.zoomIn()} aria-label="Aproximar" title="Aproximar" disabled={!engine}>
            +
          </button>
          <button type="button" className="map-control" onClick={() => engine?.zoomOut()} aria-label="Afastar" title="Afastar" disabled={!engine}>
            −
          </button>
          <button
            type="button"
            className="map-control"
            onClick={() => engine?.fitToData()}
            aria-label="Enquadrar resultados"
            title="Enquadrar resultados"
            disabled={!engine}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
            </svg>
          </button>
          <button type="button" className="map-control" onClick={() => engine?.resetView()} aria-label="Ver o Brasil inteiro" title="Ver o Brasil inteiro" disabled={!engine}>
            BR
          </button>
          <button
            type="button"
            className="map-control"
            onClick={() => switchEngine(engineKind === "3d" ? "2d" : "3d")}
            aria-pressed={engineKind === "3d"}
            aria-label={engineKind === "3d" ? "Voltar ao mapa 2D" : "Abrir globo 3D"}
            title={engineKind === "3d" ? "Mapa 2D" : "Globo 3D (Cesium)"}
          >
            {engineKind === "3d" ? "2D" : "3D"}
          </button>
          {engine?.capabilities.photorealistic ? (
            <button
              type="button"
              className="map-control"
              onClick={togglePhotoreal}
              aria-pressed={photoreal}
              aria-label="Relevo e edifícios 3D"
              title="Relevo e edifícios 3D"
            >
              ⛰
            </button>
          ) : null}
        </div>

        {data && engine && (movedSinceLoad || areaStep !== "idle" || areaMessage) ? (
          <div className="map-area-search">
            {areaStep === "confirm" ? (
              <div className="map-area-confirm glass-thick" role="dialog" aria-label="Confirmar busca nesta área">
                <p className="footnote">
                  Vamos buscar os mesmos CNAEs e filtros nos municípios cuja sede está na área visível. A nova busca fica salva no
                  histórico e segue a mesma regra de compra da lista.
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
        {filteredOut && !noneLocated ? (
          <div className="map-overlay-state glass" role="status">
            <strong>Nenhuma empresa com esses filtros.</strong>
            <button type="button" className="button-secondary button-sm" onClick={() => setFilters(DEFAULT_COMPANY_TABLE_FILTERS)}>
              Limpar filtros
            </button>
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
              <CloseButton label="Fechar lista de empresas" onClick={() => setGroupIds([])} />
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

        {region && regionStats && !selected ? (
          <section className="map-company-panel map-region-panel glass-thick" aria-labelledby="map-region-title">
            <div className="map-company-panel-head">
              <div className="stack-xs">
                <span className="eyebrow">{region.kind === "municipality" ? "Município" : "Região (H3)"}</span>
                <h3 id="map-region-title" className="title-3">
                  {regionTitle}
                </h3>
                {region.kind === "h3" ? <p className="footnote numeric">{region.id}</p> : null}
              </div>
              <CloseButton label="Fechar análise da região" onClick={() => setRegion(null)} />
            </div>
            {regionStats.total === 0 ? (
              <p className="footnote">Nenhuma empresa desta região passa pelos filtros atuais.</p>
            ) : (
              <RegionInsights stats={regionStats} scopeLabel={region.kind === "municipality" ? "no município" : "na célula"} headingLevel="h4" />
            )}
            {region.kind === "municipality" ? (
              <p className="footnote">Contagem pelo município informado no cadastro (Casa dos Dados), não pela posição no mapa.</p>
            ) : (
              <p className="footnote">Empresas atribuídas pela coordenada conhecida (sem o espalhamento visual dos marcadores).</p>
            )}
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

      {sheetOpen ? <div className="map-sheet-backdrop" onClick={() => setSheetOpen(false)} aria-hidden="true" /> : null}
      <div
        id="map-mobile-sheet"
        className={`map-sheet glass-thick${sheetOpen ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={view === "inteligencia" ? "Filtros e análise" : "Filtros e camadas"}
        hidden={!sheetOpen}
      >
        <div className="map-sheet-head">
          <span className="headline">{view === "inteligencia" ? "Filtros e análise" : "Filtros e camadas"}</span>
          <button type="button" className="button-ghost button-sm" onClick={() => setSheetOpen(false)}>
            Fechar
          </button>
        </div>
        {sheetOpen ? renderSidebar("map-sheet") : null}
      </div>
    </div>
  );
}

function CloseButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="button-icon" onClick={onClick} aria-label={label}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M3 3l8 8M11 3l-8 8" />
      </svg>
    </button>
  );
}

function MapLegendBlock({ mode, legend }: { mode: MapLayerMode; legend: MapViewInfo["legend"] }) {
  return (
    <div className="map-legend" aria-label="Legenda do mapa">
      <span className="field-label">Legenda</span>
      {mode === "companies" ? (
        <ul>
          <li>
            <span className="map-legend-swatch" data-variant="cluster" aria-hidden="true" /> Grupo de empresas (toque para aproximar)
          </li>
          <li>
            <span className="map-legend-swatch" data-variant="precise" aria-hidden="true" /> {PRECISION_LABELS.address}
          </li>
          <li>
            <span className="map-legend-swatch" data-variant="approximate" aria-hidden="true" /> Localização aproximada (município/CEP)
          </li>
        </ul>
      ) : legend ? (
        <>
          <span className="footnote">{legend.title}</span>
          <ul className="map-legend-bins">
            {legend.bins.map((bin) => (
              <li key={`${bin.min}-${bin.max}`}>
                <span className="map-legend-swatch" style={{ background: bin.color }} aria-hidden="true" />
                <span className="numeric">
                  {bin.min === bin.max ? numberFormat.format(bin.min) : `${numberFormat.format(bin.min)}–${numberFormat.format(bin.max)}`}
                </span>
              </li>
            ))}
          </ul>
          {legend.note ? <p className="footnote">{legend.note}</p> : null}
        </>
      ) : (
        <p className="footnote">Sem dados para a camada {MAP_LAYER_LABELS[mode].toLowerCase()}.</p>
      )}
    </div>
  );
}
