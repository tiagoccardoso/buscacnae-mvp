import type { Map as MapLibreMap, MapLibreEvent } from "maplibre-gl";
import type { PickingInfo } from "@deck.gl/core";
import type { MapLibreOverlay as MapLibreOverlayType } from "@deck.gl/maplibre";
import { CLUSTER_MAX_ZOOM, createCompanyClusterIndex, formatClusterCount, type CompanyClusterIndex, type MapCluster, type MapPoint } from "@/lib/map/clustering";
import type { BusinessMapEngine, MapEngineFactory, MapLegend } from "@/lib/map/engine-contract";
import { BRAZIL_BOUNDS, viewScaleForHeight, zoomToHeight } from "@/lib/map/geo";
import { aggregateByMunicipality, type MunicipalityAggregate } from "@/lib/map/intelligence/region-stats";
import { buildColorBins, colorForValue, sequentialRamp, type ColorBin, type Rgba } from "@/lib/map/intelligence/color-scale";
import {
  aggregateCompaniesByH3,
  describeCellArea,
  maxResolutionForPrecision,
  resolutionForZoom,
  type H3Cell
} from "@/lib/map/intelligence/h3-grid";
import { createDisposerStack, debounce } from "@/lib/map/lifecycle";
import { MAPLIBRE_LOCALE_PT_BR, fallbackBasemap, rasterPaint, resolveBasemap, type ResolvedBasemap } from "@/lib/map/maplibre/styles";
import { cssColorToRgba, detectTheme, readMapPalette, type MapPalette } from "@/lib/map/palette";
import { computeDataBounds, legendFromBins, padBounds, visibleCompanies } from "@/lib/map/view-model";
import { isPreciseLocation, type GeoBounds, type MapCompany, type MapLayerMode, type MapPrecisionStats, type MapRegionSeat } from "@/lib/map/types";

/**
 * Motor 2D operacional do Mapa Empresarial: MapLibre GL (mapa base, câmera, gestos) +
 * deck.gl (camadas de dados na GPU, via @deck.gl/maplibre em modo sobreposto).
 *
 * - Nenhum componente React por empresa: cada camada é um único draw call do deck.gl.
 * - Clusters vêm do mesmo índice supercluster do 3D; H3 e Regiões são agregados em
 *   memória e recalculados só quando os dados (ou a resolução H3) mudam.
 * - O mapa é criado UMA vez; dados, camada, seleção e tema chegam por métodos.
 */
const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
const MAX_RENDERED_POINTS = 20_000;
const MAX_NAME_LABELS = 150;
const NAME_LABEL_MIN_ZOOM = 13;
const CELL_LABEL_MIN_ZOOM = 7;
const COLOR_STEPS = 6;
const STYLE_LOAD_TIMEOUT_MS = 10_000;

/** Tooltip no padrão visual do design system (o deck.gl aplica estilos inline). */
const TOOLTIP_STYLE: Partial<CSSStyleDeclaration> = {
  backgroundColor: "var(--bg-elevated)",
  color: "var(--label)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-footnote)",
  padding: "6px 10px",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-2)",
  maxWidth: "18rem",
  whiteSpace: "normal"
};

type Colors = {
  accent: Rgba;
  accentContrast: Rgba;
  label: Rgba;
  bgElevated: Rgba;
  warning: Rgba;
  ramp: Rgba[];
};

type ClusterDatum = MapCluster & { label: string };
type PointDatum = MapPoint & { name: string; approximate: boolean };
type RegionDatum = MunicipalityAggregate & { label: string };

type Picked =
  | { type: "cluster"; datum: ClusterDatum }
  | { type: "company"; datum: PointDatum }
  | { type: "h3"; datum: H3Cell }
  | { type: "region"; datum: RegionDatum };

function toColors(palette: MapPalette): Colors {
  const accent = cssColorToRgba(palette.accent);
  const bgElevated = cssColorToRgba(palette.bgElevated);
  return {
    accent,
    accentContrast: cssColorToRgba(palette.accentContrast),
    label: cssColorToRgba(palette.label),
    bgElevated,
    warning: cssColorToRgba(palette.warning),
    ramp: sequentialRamp(bgElevated, accent, COLOR_STEPS, 205)
  };
}

function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], alpha];
}

function precisionStats(companies: readonly MapCompany[]): MapPrecisionStats {
  const stats: MapPrecisionStats = { exact: 0, address: 0, postal_code: 0, city: 0, approximate: 0 };
  for (const company of companies) if (company.location) stats[company.location.precision] += 1;
  return stats;
}

function boundsFromMap(map: MapLibreMap): GeoBounds {
  const bounds = map.getBounds();
  return {
    west: Math.max(-180, bounds.getWest()),
    south: Math.max(-85, bounds.getSouth()),
    east: Math.min(180, bounds.getEast()),
    north: Math.min(85, bounds.getNorth())
  };
}

function toLngLatBounds(bounds: GeoBounds): [[number, number], [number, number]] {
  return [
    [bounds.west, bounds.south],
    [bounds.east, bounds.north]
  ];
}

/**
 * Aplica o estilo e espera só o ESTILO ("style.load"), não os tiles: as camadas de dados
 * não dependem das imagens do mapa base, então tiles lentos ou bloqueados não atrasam a
 * exibição das empresas. (map.isStyleLoaded()/"load" esperam também os tiles.)
 */
function applyStyleAndWait(map: MapLibreMap, style: ResolvedBasemap["style"], signal: AbortSignal) {
  return new Promise<"loaded" | "timeout">((resolve, reject) => {
    const timer = setTimeout(() => finish("timeout"), STYLE_LOAD_TIMEOUT_MS);
    const onLoad = () => finish("loaded");
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    function cleanup() {
      clearTimeout(timer);
      map.off("style.load", onLoad);
      signal.removeEventListener("abort", onAbort);
    }
    function finish(result: "loaded" | "timeout") {
      cleanup();
      resolve(result);
    }
    map.once("style.load", onLoad);
    signal.addEventListener("abort", onAbort, { once: true });
    map.setStyle(style);
  });
}

export const createMapLibreEngine: MapEngineFactory = async (options, signal) => {
  const [maplibre, deckMaplibre, deckLayers] = await Promise.all([
    import("maplibre-gl"),
    import("@deck.gl/maplibre"),
    import("@deck.gl/layers")
  ]);
  signal.throwIfAborted();

  const { ScatterplotLayer, TextLayer, PolygonLayer } = deckLayers;
  maplibre.setWorkerUrl(MAPLIBRE_WORKER_URL);

  const stack = createDisposerStack();
  let palette = readMapPalette();
  let colors = toColors(palette);
  const retina = typeof window !== "undefined" && window.devicePixelRatio > 1.25;
  let basemap: ResolvedBasemap = resolveBasemap(options.config, palette.theme, retina);

  const initial = options.initialBounds ?? BRAZIL_BOUNDS;
  const map = new maplibre.Map({
    container: options.container,
    // Estilo aplicado logo abaixo (applyStyleAndWait), com o listener já registrado.
    bounds: toLngLatBounds(initial),
    fitBoundsOptions: { padding: 24 },
    minZoom: 2,
    maxZoom: 19,
    renderWorldCopies: false,
    // Mapa operacional 2D: sem rotação/inclinação (evita desorientação no touch).
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    keyboard: false,
    attributionControl: { compact: true },
    locale: MAPLIBRE_LOCALE_PT_BR,
    cancelPendingTileRequestsWhileZooming: true
  });
  stack.defer(() => map.remove());
  map.touchZoomRotate.disableRotation();

  try {
    // O próprio contêiner (role="application") recebe o foco; o canvas não entra na ordem de tabulação.
    map.getCanvas().setAttribute("tabindex", "-1");

    let fellBack = false;
    let styleReady = false;
    const onStyleReady = () => {
      styleReady = true;
    };
    map.on("style.load", onStyleReady);
    stack.defer(() => map.off("style.load", onStyleReady));
    const onStyleError = (event: { error?: { message?: string } }) => {
      // Só falhas do próprio estilo (antes de carregar); tile com erro não troca o mapa base.
      if (fellBack || styleReady) return;
      // Estilo externo indisponível (rede, cota, CORS): o mapa segue com o fundo local.
      console.warn("[map] estilo do mapa base indisponível; usando fundo local", event.error?.message ?? "");
      fellBack = true;
      basemap = fallbackBasemap(palette.theme);
      map.setStyle(basemap.style);
    };
    map.on("error", onStyleError);
    stack.defer(() => map.off("error", onStyleError));

    const loaded = await applyStyleAndWait(map, basemap.style, signal);
    if (loaded === "timeout" && !styleReady && !fellBack) {
      fellBack = true;
      basemap = fallbackBasemap(palette.theme);
      map.setStyle(basemap.style);
    }
    signal.throwIfAborted();

    const overlay: MapLibreOverlayType = new deckMaplibre.MapLibreOverlay({
      interleaved: false,
      layers: [],
      pickingRadius: 8,
      useDevicePixels: true,
      onClick: (info: PickingInfo) => handleClick(info),
      onHover: (info: PickingInfo) => {
        map.getCanvas().style.cursor = info.picked ? "pointer" : "";
      },
      getTooltip: (info: PickingInfo) => tooltipFor(info)
    });
    map.addControl(overlay);
    stack.defer(() => {
      try {
        map.removeControl(overlay);
      } catch {
        /* mapa já removido */
      }
      overlay.finalize();
    });

    // ---------------------------------------------------------------- estado
    let companies: MapCompany[] = [];
    let companiesById = new Map<string, MapCompany>();
    let regions: MapRegionSeat[] = [];
    let index: CompanyClusterIndex = createCompanyClusterIndex([]);
    let dataBounds: GeoBounds | null = null;
    let mode: MapLayerMode = "companies";
    let selectedId: string | null = null;
    let selectedRegionId: string | null = null;
    let h3Cache = new Map<number, { cells: H3Cell[]; bins: ColorBin[] }>();
    let municipalities: { regions: RegionDatum[]; unmatched: number; bins: ColorBin[] } | null = null;
    let maxH3Resolution = 6;
    let destroyed = false;

    function h3For(resolution: number) {
      let entry = h3Cache.get(resolution);
      if (!entry) {
        const cells = aggregateCompaniesByH3(companies, resolution);
        entry = { cells, bins: buildColorBins(cells.map((cell) => cell.count), colors.ramp) };
        h3Cache.set(resolution, entry);
      }
      return entry;
    }

    function municipalityData() {
      if (!municipalities) {
        const aggregate = aggregateByMunicipality(companies, regions);
        const data = aggregate.regions.map<RegionDatum>((region) => ({ ...region, label: formatClusterCount(region.count) }));
        municipalities = { regions: data, unmatched: aggregate.unmatched, bins: buildColorBins(data.map((item) => item.count), colors.ramp) };
      }
      return municipalities;
    }

    function companyName(id: string) {
      return companiesById.get(id)?.displayName ?? "";
    }

    // ---------------------------------------------------------------- camadas
    function buildCompanyLayers(bounds: GeoBounds, zoom: number) {
      const items = index.query(padBounds(bounds, 0.15), zoom);
      const clusterData: ClusterDatum[] = [];
      const pointData: PointDatum[] = [];
      for (const item of items) {
        if (item.kind === "cluster") clusterData.push({ ...item, label: formatClusterCount(item.count) });
        else if (pointData.length < MAX_RENDERED_POINTS)
          pointData.push({ ...item, name: companyName(item.companyId), approximate: !isPreciseLocation(item.precision) });
      }

      let selectedDatum: PointDatum | null = pointData.find((point) => point.companyId === selectedId) ?? null;
      if (selectedId && !selectedDatum) {
        const location = companiesById.get(selectedId)?.location;
        if (location) {
          selectedDatum = {
            kind: "company",
            companyId: selectedId,
            latitude: location.displayLatitude,
            longitude: location.displayLongitude,
            precision: location.precision,
            name: companyName(selectedId),
            approximate: !isPreciseLocation(location.precision)
          };
        }
      }

      const maxCount = clusterData.reduce((max, cluster) => Math.max(max, cluster.count), 1);
      const clusterRadius = (count: number) => 13 + 17 * Math.sqrt(Math.log10(count + 1) / Math.log10(maxCount + 1));

      const layers = [
        new ScatterplotLayer<ClusterDatum>({
          id: "clusters",
          data: clusterData,
          pickable: true,
          radiusUnits: "pixels",
          stroked: true,
          lineWidthUnits: "pixels",
          getLineWidth: 2,
          getPosition: (d) => [d.longitude, d.latitude],
          getRadius: (d) => clusterRadius(d.count),
          // Grupos só com localização aproximada ficam mais claros (legenda).
          getFillColor: (d) => withAlpha(colors.accent, d.approximate === d.count ? 150 : 225),
          getLineColor: withAlpha(colors.bgElevated, 235),
          updateTriggers: { getFillColor: [colors.accent], getRadius: [maxCount] }
        }),
        new TextLayer<ClusterDatum>({
          id: "cluster-counts",
          data: clusterData,
          getPosition: (d) => [d.longitude, d.latitude],
          getText: (d) => d.label,
          getSize: 12,
          getColor: colors.accentContrast,
          fontFamily: palette.fontFamily,
          fontWeight: 600,
          characterSet: "0123456789.,mil ",
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          updateTriggers: { getColor: [colors.accentContrast] }
        }),
        new ScatterplotLayer<PointDatum>({
          id: "companies",
          data: pointData,
          pickable: true,
          radiusUnits: "pixels",
          stroked: true,
          filled: true,
          lineWidthUnits: "pixels",
          getPosition: (d) => [d.longitude, d.latitude],
          getRadius: 6,
          getLineWidth: (d) => (d.approximate ? 2 : 1.5),
          // Ponto cheio = endereço; anel vazado = localização aproximada (nunca parece exata).
          getFillColor: (d) => (d.approximate ? withAlpha(colors.bgElevated, 200) : colors.accent),
          getLineColor: (d) => (d.approximate ? colors.accent : withAlpha(colors.bgElevated, 240)),
          updateTriggers: { getFillColor: [colors.accent, colors.bgElevated], getLineColor: [colors.accent, colors.bgElevated] }
        })
      ];

      if (zoom >= NAME_LABEL_MIN_ZOOM && pointData.length > 0) {
        layers.push(
          new TextLayer<PointDatum>({
            id: "company-names",
            data: pointData.slice(0, MAX_NAME_LABELS),
            getPosition: (d) => [d.longitude, d.latitude],
            getText: (d) => (d.name.length > 32 ? `${d.name.slice(0, 31)}…` : d.name),
            getSize: 12,
            getPixelOffset: [0, -16],
            getColor: colors.label,
            background: true,
            getBackgroundColor: withAlpha(colors.bgElevated, 225),
            backgroundPadding: [4, 2],
            fontFamily: palette.fontFamily,
            characterSet: "auto",
            getTextAnchor: "middle",
            getAlignmentBaseline: "bottom",
            updateTriggers: { getColor: [colors.label], getBackgroundColor: [colors.bgElevated] }
          }) as never
        );
      }

      if (selectedDatum) {
        layers.push(
          new ScatterplotLayer<PointDatum>({
            id: "selected-company",
            data: [selectedDatum],
            radiusUnits: "pixels",
            stroked: true,
            filled: false,
            lineWidthUnits: "pixels",
            getPosition: (d) => [d.longitude, d.latitude],
            getRadius: 12,
            getLineWidth: 3,
            getLineColor: colors.label,
            updateTriggers: { getLineColor: [colors.label] }
          })
        );
      }

      return { layers, clusterCount: clusterData.length };
    }

    function concentrationResolution(zoom: number) {
      return Math.min(resolutionForZoom(zoom), maxH3Resolution);
    }

    function buildConcentrationLayers(zoom: number) {
      const resolution = concentrationResolution(zoom);
      const { cells, bins } = h3For(resolution);
      const layers = [
        new PolygonLayer<H3Cell>({
          id: `h3-cells`,
          data: cells,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthUnits: "pixels",
          getPolygon: (d) => d.polygon,
          getFillColor: (d) => colorForValue(d.count, bins),
          getLineColor: (d) => (d.id === selectedRegionId ? colors.label : withAlpha(colors.bgElevated, 180)),
          getLineWidth: (d) => (d.id === selectedRegionId ? 3 : 1),
          autoHighlight: true,
          highlightColor: withAlpha(colors.label, 40),
          updateTriggers: {
            getFillColor: [resolution, colors.ramp[COLOR_STEPS - 1]],
            getLineColor: [selectedRegionId, colors.label],
            getLineWidth: [selectedRegionId]
          }
        })
      ];
      if (zoom >= CELL_LABEL_MIN_ZOOM && cells.length <= 600) {
        layers.push(
          new TextLayer<H3Cell>({
            id: "h3-counts",
            data: cells,
            getPosition: (d) => [d.longitude, d.latitude],
            getText: (d) => formatClusterCount(d.count),
            getSize: 12,
            getColor: colors.label,
            fontFamily: palette.fontFamily,
            fontWeight: 600,
            characterSet: "0123456789.,mil ",
            outlineWidth: 2,
            outlineColor: withAlpha(colors.bgElevated, 230),
            fontSettings: { sdf: true },
            updateTriggers: { getColor: [colors.label] }
          }) as never
        );
      }
      const precise = resolution >= 8;
      const note =
        resolution < resolutionForZoom(zoom)
          ? `Células de ~${describeCellArea(cells[0]?.areaKm2 ?? 36)}: a maioria das empresas tem localização aproximada (sede do município ou CEP), então não dividimos em áreas menores.`
          : precise
            ? null
            : `Células H3 de ~${describeCellArea(cells[0]?.areaKm2 ?? 0)}. Aproxime o mapa para células menores.`;
      const legend: MapLegend | null = legendFromBins(`Empresas por célula H3 (resolução ${resolution})`, bins, note);
      return { layers, resolution, legend };
    }

    function buildRegionLayers(zoom: number) {
      const data = municipalityData();
      const maxCount = data.regions.reduce((max, region) => Math.max(max, region.count), 1);
      // Em visão nacional os círculos pequenos encolhem para não cobrir o mapa.
      const minRadius = zoom < 5 ? 3 : zoom < 7 ? 5 : 8;
      const maxRadius = zoom < 5 ? 26 : 34;
      const radius = (count: number) => minRadius + (maxRadius - minRadius) * Math.sqrt(count / maxCount);
      // Rótulos só onde cabem: poucos em visão nacional, todos ao aproximar.
      const labelLimit = zoom < 5 ? 25 : zoom < 7 ? 80 : 400;
      const labelled = data.regions.slice(0, labelLimit).filter((region) => radius(region.count) >= 11);
      const layers = [
        new ScatterplotLayer<RegionDatum>({
          id: "regions",
          data: data.regions,
          pickable: true,
          radiusUnits: "pixels",
          stroked: true,
          lineWidthUnits: "pixels",
          getPosition: (d) => [d.seat.longitude, d.seat.latitude],
          getRadius: (d) => radius(d.count),
          getFillColor: (d) => colorForValue(d.count, data.bins),
          radiusMinPixels: 2,
          getLineColor: (d) => (d.seat.key === selectedRegionId ? colors.label : withAlpha(colors.bgElevated, 235)),
          getLineWidth: (d) => (d.seat.key === selectedRegionId ? 3 : 1.5),
          autoHighlight: true,
          highlightColor: withAlpha(colors.label, 40),
          updateTriggers: {
            getRadius: [maxCount, minRadius, maxRadius],
            getFillColor: [colors.ramp[COLOR_STEPS - 1]],
            getLineColor: [selectedRegionId, colors.label],
            getLineWidth: [selectedRegionId]
          }
        }),
        new TextLayer<RegionDatum>({
          id: "region-counts",
          data: labelled,
          getPosition: (d) => [d.seat.longitude, d.seat.latitude],
          getText: (d) => d.label,
          getSize: 12,
          getColor: colors.label,
          fontFamily: palette.fontFamily,
          fontWeight: 600,
          characterSet: "0123456789.,mil ",
          outlineWidth: 2,
          outlineColor: withAlpha(colors.bgElevated, 230),
          fontSettings: { sdf: true },
          updateTriggers: { getColor: [colors.label] }
        }) as never
      ];
      if (zoom >= 7) {
        layers.push(
          new TextLayer<RegionDatum>({
            id: "region-names",
            data: labelled.slice(0, 200),
            getPosition: (d) => [d.seat.longitude, d.seat.latitude],
            getText: (d) => `${d.seat.name}/${d.seat.stateCode}`,
            getSize: 11,
            getPixelOffset: (d) => [0, radius(d.count) + 8],
            getColor: colors.label,
            background: true,
            getBackgroundColor: withAlpha(colors.bgElevated, 220),
            backgroundPadding: [4, 2],
            fontFamily: palette.fontFamily,
            characterSet: "auto",
            updateTriggers: { getColor: [colors.label], getBackgroundColor: [colors.bgElevated], getPixelOffset: [maxCount, minRadius, maxRadius] }
          }) as never
        );
      }
      const note =
        data.unmatched > 0
          ? `${formatClusterCount(data.unmatched)} empresa(s) sem município identificado na base IBGE ficam fora desta camada.`
          : "Cada círculo fica na sede do município (IBGE), não no endereço das empresas.";
      return { layers, legend: legendFromBins("Empresas por município", data.bins, note) };
    }

    // ---------------------------------------------------------------- render
    function refresh() {
      if (destroyed) return;
      const bounds = boundsFromMap(map);
      const zoom = map.getZoom();
      let layers: unknown[] = [];
      let clusterCount = 0;
      let h3Resolution: number | null = null;
      let legend: MapLegend | null = null;

      if (mode === "companies") {
        const result = buildCompanyLayers(bounds, zoom);
        layers = result.layers;
        clusterCount = result.clusterCount;
      } else if (mode === "concentration") {
        const result = buildConcentrationLayers(zoom);
        layers = result.layers;
        h3Resolution = result.resolution;
        legend = result.legend;
      } else {
        const result = buildRegionLayers(zoom);
        layers = result.layers;
        legend = result.legend;
      }

      overlay.setProps({ layers: layers as never });

      const visible = visibleCompanies(companies, bounds);
      options.onViewChange({
        bounds,
        zoom,
        scale: viewScaleForHeight(zoomToHeight(zoom)),
        visibleCompanyCount: visible.count,
        visibleCompanyIds: visible.ids,
        clusterCount,
        h3Resolution,
        legend
      });
    }

    const scheduleRefresh = debounce(refresh, 60);
    stack.defer(() => scheduleRefresh.cancel());
    // Só "moveend": nada é recalculado a cada quadro do movimento.
    map.on("moveend", scheduleRefresh);
    stack.defer(() => map.off("moveend", scheduleRefresh));

    const onMoveStart = (event: MapLibreEvent & { originalEvent?: unknown }) => {
      if (event.originalEvent) options.onUserMove?.();
    };
    map.on("movestart", onMoveStart);
    stack.defer(() => map.off("movestart", onMoveStart));

    // ---------------------------------------------------------------- interação
    function pickedOf(info: PickingInfo): Picked | null {
      if (!info.picked || !info.object || !info.layer) return null;
      switch (info.layer.id) {
        case "clusters":
          return { type: "cluster", datum: info.object as ClusterDatum };
        case "companies":
          return { type: "company", datum: info.object as PointDatum };
        case "h3-cells":
          return { type: "h3", datum: info.object as H3Cell };
        case "regions":
          return { type: "region", datum: info.object as RegionDatum };
        default:
          return null;
      }
    }

    function tooltipFor(info: PickingInfo) {
      const picked = pickedOf(info);
      if (!picked) return null;
      const number = new Intl.NumberFormat("pt-BR");
      let text: string;
      switch (picked.type) {
        case "cluster":
          text = `${number.format(picked.datum.count)} empresas · clique para aproximar`;
          break;
        case "company":
          text = picked.datum.approximate ? `${picked.datum.name} · localização aproximada` : picked.datum.name;
          break;
        case "h3":
          text = `${number.format(picked.datum.count)} empresa(s) nesta célula (~${describeCellArea(picked.datum.areaKm2)})`;
          break;
        case "region":
          text = `${picked.datum.seat.name}/${picked.datum.seat.stateCode}: ${number.format(picked.datum.count)} empresa(s)`;
          break;
      }
      return { text, className: "map-tooltip", style: TOOLTIP_STYLE };
    }

    /**
     * Deslocamento do alvo para que o painel da empresa/região não cubra o ponto:
     * no mobile o painel é um bottom sheet (alvo sobe); no desktop fica à direita.
     */
    function panelOffset(): [number, number] {
      const width = options.container.clientWidth;
      const height = options.container.clientHeight;
      if (width <= 820) return [0, -Math.round(height * 0.26)];
      return [-Math.round(Math.min(210, width * 0.2)), 0];
    }

    function easeTo(latitude: number, longitude: number, zoom: number, withPanel = false) {
      map.easeTo({
        center: [longitude, latitude],
        zoom: Math.min(zoom, 19),
        duration: 700,
        essential: true,
        offset: withPanel ? panelOffset() : [0, 0]
      });
    }

    function handleClick(info: PickingInfo) {
      const picked = pickedOf(info);
      if (!picked) {
        if (selectedId) options.onSelect(null);
        if (selectedRegionId) options.onRegionSelect(null);
        return;
      }
      if (picked.type === "company") {
        options.onSelect(picked.datum.companyId);
        return;
      }
      if (picked.type === "cluster") {
        const expansionZoom = index.expansionZoom(picked.datum.clusterId);
        const zoomNow = map.getZoom();
        // Empresas no mesmo ponto (mesmo CEP/município) nunca se separam: entrega a lista.
        if (expansionZoom > CLUSTER_MAX_ZOOM || zoomNow >= CLUSTER_MAX_ZOOM) {
          options.onGroupSelect(index.leaves(picked.datum.clusterId, 100));
          return;
        }
        easeTo(picked.datum.latitude, picked.datum.longitude, Math.max(expansionZoom + 0.5, zoomNow + 1));
        return;
      }
      if (picked.type === "h3") {
        const cell = picked.datum;
        options.onRegionSelect({
          kind: "h3",
          id: cell.id,
          resolution: cell.resolution,
          companyIds: cell.companyIds,
          latitude: cell.latitude,
          longitude: cell.longitude
        });
        return;
      }
      const region = picked.datum;
      options.onRegionSelect({
        kind: "municipality",
        id: region.seat.key,
        name: region.seat.name,
        stateCode: region.seat.stateCode,
        companyIds: region.companyIds,
        latitude: region.seat.latitude,
        longitude: region.seat.longitude
      });
    }

    // Teclado no contêiner do mapa: setas movem, +/− aproximam, Esc fecha o painel.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== options.container) return;
      const step = 120;
      switch (event.key) {
        case "ArrowUp":
          map.panBy([0, -step]);
          break;
        case "ArrowDown":
          map.panBy([0, step]);
          break;
        case "ArrowLeft":
          map.panBy([-step, 0]);
          break;
        case "ArrowRight":
          map.panBy([step, 0]);
          break;
        case "+":
        case "=":
          map.zoomIn();
          break;
        case "-":
        case "_":
          map.zoomOut();
          break;
        case "Escape":
          options.onSelect(null);
          options.onRegionSelect(null);
          return;
        default:
          return;
      }
      options.onUserMove?.();
      event.preventDefault();
    };
    options.container.addEventListener("keydown", onKeyDown);
    stack.defer(() => options.container.removeEventListener("keydown", onKeyDown));

    // Tema claro/escuro: recolore camadas e mapa base sem recriar o mapa.
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onThemeChange = () => {
      palette = readMapPalette();
      colors = toColors(palette);
      h3Cache = new Map();
      municipalities = null;
      const theme = detectTheme();
      if (basemap.themeable && map.getLayer("basemap")) {
        for (const [key, value] of Object.entries(rasterPaint(theme, false))) {
          map.setPaintProperty("basemap", key as never, value as never);
        }
        if (map.getLayer("background")) map.setPaintProperty("background", "background-color", theme === "dark" ? "#1c1c1e" : "#e9eef3");
      } else if (basemap.id !== "custom") {
        basemap = basemap.id === "offline" ? fallbackBasemap(theme) : resolveBasemap(options.config, theme, retina);
        map.setStyle(basemap.style);
      }
      refresh();
    };
    media?.addEventListener?.("change", onThemeChange);
    stack.defer(() => media?.removeEventListener?.("change", onThemeChange));

    function fitBounds(bounds: GeoBounds, animate = true) {
      map.fitBounds(toLngLatBounds(bounds), { padding: 48, maxZoom: 14, duration: animate ? 900 : 0, essential: true });
    }

    const engine: BusinessMapEngine = {
      capabilities: { kind: "2d", modes: ["companies", "concentration", "regions"], photorealistic: false },
      setData(next, { fit = false } = {}) {
        companies = next.companies;
        regions = next.regions;
        companiesById = new Map(companies.map((company) => [company.id, company]));
        index = createCompanyClusterIndex(companies);
        h3Cache = new Map();
        municipalities = null;
        maxH3Resolution = maxResolutionForPrecision(precisionStats(companies));
        dataBounds = computeDataBounds(companies);
        if (selectedId && !companiesById.has(selectedId)) selectedId = null;
        if (fit && dataBounds) fitBounds(dataBounds);
        refresh();
      },
      setMode(next) {
        if (mode === next) return;
        mode = next;
        selectedRegionId = null;
        refresh();
      },
      setSelected(companyId) {
        if (selectedId === companyId) return;
        selectedId = companyId;
        refresh();
      },
      setSelectedRegion(regionId) {
        if (selectedRegionId === regionId) return;
        selectedRegionId = regionId;
        refresh();
      },
      focusCompany(companyId) {
        const company = companiesById.get(companyId);
        if (!company?.location) return;
        selectedId = companyId;
        const precise = isPreciseLocation(company.location.precision);
        easeTo(company.location.displayLatitude, company.location.displayLongitude, precise ? 16 : 12, true);
        refresh();
      },
      focusPoint(latitude, longitude, zoom) {
        easeTo(latitude, longitude, zoom, true);
      },
      zoomIn() {
        map.zoomIn();
      },
      zoomOut() {
        map.zoomOut();
      },
      resetView() {
        fitBounds(BRAZIL_BOUNDS);
      },
      fitToData() {
        fitBounds(dataBounds ?? BRAZIL_BOUNDS);
      },
      async setPhotorealistic() {
        return false;
      },
      getViewBounds() {
        return boundsFromMap(map);
      },
      destroy() {
        destroyed = true;
        stack.dispose();
      }
    };

    refresh();
    return engine;
  } catch (error) {
    stack.dispose();
    throw error;
  }
};
