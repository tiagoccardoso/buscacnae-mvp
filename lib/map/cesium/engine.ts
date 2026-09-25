import type * as Cesium from "cesium";
import { CLUSTER_MAX_ZOOM, createCompanyClusterIndex, type CompanyClusterIndex, type MapCluster, type MapPoint } from "@/lib/map/clustering";
import type { BusinessMapEngine, MapEngineFactory, MapLegend } from "@/lib/map/engine-contract";
import { BRAZIL_BOUNDS, boundsContain, heightToZoom, viewScaleForHeight, zoomToHeight } from "@/lib/map/geo";
import { aggregateCompaniesByH3, describeCellArea, maxResolutionForPrecision, resolutionForZoom, type H3Cell } from "@/lib/map/intelligence/h3-grid";
import type { GeoBounds, MapCompany, MapLayerMode, MapPrecisionStats } from "@/lib/map/types";
import { loadCesium, type CesiumModule } from "@/lib/map/cesium/cesium-loader";
import { createDisposerStack, debounce } from "@/lib/map/lifecycle";
import { detectTheme, readMapPalette } from "@/lib/map/palette";
import { applyBasemap, canUsePhotorealistic3D, loadPhotorealistic3D } from "@/lib/map/cesium/providers";
import { createBusinessViewer, installTrackpadPinchZoom } from "@/lib/map/cesium/viewer";
import { createClustersLayer } from "@/lib/map/cesium/layers/clusters-layer";
import { createCompaniesLayer } from "@/lib/map/cesium/layers/companies-layer";
import { createH3ColumnsLayer } from "@/lib/map/cesium/layers/h3-columns-layer";
import type { LayerContext, MapLayer, PickTarget, RenderFrame, ViewState } from "@/lib/map/cesium/layers/types";
import { computeDataBounds, legendFromBins, visibleCompanies } from "@/lib/map/view-model";

/**
 * Motor 3D OPCIONAL do Mapa Empresarial (CesiumJS, somente navegador).
 *
 * O mapa operacional é o 2D (MapLibre + deck.gl). Este motor só é carregado quando o
 * usuário pede o globo 3D: cria/destrói o viewer, orquestra camadas, índice de clusters,
 * câmera, seleção e eventos pelo mesmo contrato do 2D (lib/map/engine-contract.ts).
 * Camadas: Empresas (clusters + pontos) e Concentração (colunas H3 extrudadas).
 */
const MAX_RENDERED_POINTS = 3000;

function precisionStats(companies: readonly MapCompany[]): MapPrecisionStats {
  const stats: MapPrecisionStats = { exact: 0, address: 0, postal_code: 0, city: 0, approximate: 0 };
  for (const company of companies) if (company.location) stats[company.location.precision] += 1;
  return stats;
}

function rectangleToBounds(C: CesiumModule, rectangle: Cesium.Rectangle | undefined): GeoBounds {
  if (!rectangle) return { west: -180, south: -85, east: 180, north: 85 };
  return {
    west: C.Math.toDegrees(rectangle.west),
    south: C.Math.toDegrees(rectangle.south),
    east: C.Math.toDegrees(rectangle.east),
    north: C.Math.toDegrees(rectangle.north)
  };
}

export const createCesiumEngine: MapEngineFactory = async (options, signal) => {
  const C = await loadCesium();
  signal.throwIfAborted();

  const stack = createDisposerStack();
  const viewer = createBusinessViewer(C, options.container, options.creditContainer);
  stack.defer(() => {
    if (!viewer.isDestroyed()) viewer.destroy();
  });

  try {
    stack.defer(installTrackpadPinchZoom(C, viewer));

    const requestRender = () => {
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };

    let palette = readMapPalette();
    const basemap = await applyBasemap(C, viewer, options.config);
    stack.defer(() => basemap.dispose());
    basemap.setTheme(palette.theme);
    signal.throwIfAborted();

    viewer.scene.globe.baseColor = C.Color.fromCssColorString(palette.theme === "dark" ? "#1c1c1e" : "#dfe6ee");

    const layerContext: LayerContext = { C, viewer, palette, requestRender };
    const h3Columns = createH3ColumnsLayer(layerContext);
    const clusters = createClustersLayer(layerContext);
    const companiesLayer = createCompaniesLayer(layerContext);
    const layers: MapLayer[] = [h3Columns, clusters, companiesLayer];
    stack.defer(() => {
      for (const layer of layers) layer.destroy();
    });

    let companies: MapCompany[] = [];
    let companiesById = new Map<string, MapCompany>();
    let index: CompanyClusterIndex = createCompanyClusterIndex([]);
    let selectedId: string | null = null;
    let selectedRegionId: string | null = null;
    let mode: MapLayerMode = "companies";
    let dataBounds: GeoBounds | null = null;
    let photoreal: Cesium.Cesium3DTileset | null = null;
    let maxH3Resolution = 6;
    let h3Resolution: number | null = null;
    let h3Cells: H3Cell[] = [];
    let h3Legend: MapLegend | null = null;
    // Movimentos de câmera feitos pelo código (enquadrar, focar) não contam como "usuário mexeu".
    let programmaticUntil = 0;
    const markProgrammatic = (seconds: number) => {
      programmaticUntil = Math.max(programmaticUntil, performance.now() + seconds * 1000 + 600);
    };

    const camera = viewer.camera;

    function currentHeight() {
      const height = camera.positionCartographic?.height;
      return Number.isFinite(height) ? height : 20_000_000;
    }

    /**
     * Retângulo visível. No 2D (e em ângulos em que o Cesium não calcula o retângulo)
     * amostra a borda da tela contra o elipsoide.
     */
    function computeVisibleBounds(): GeoBounds {
      const rectangle = camera.computeViewRectangle(C.Ellipsoid.WGS84);
      if (rectangle && viewer.scene.mode === C.SceneMode.SCENE3D) return rectangleToBounds(C, rectangle);

      const canvas = viewer.scene.canvas;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      let west = Infinity;
      let east = -Infinity;
      let south = Infinity;
      let north = -Infinity;
      let hits = 0;
      const steps = 4;
      for (let ix = 0; ix <= steps; ix += 1) {
        for (let iy = 0; iy <= steps; iy += 1) {
          if (ix !== 0 && ix !== steps && iy !== 0 && iy !== steps) continue;
          const point = camera.pickEllipsoid(new C.Cartesian2((width * ix) / steps, (height * iy) / steps), C.Ellipsoid.WGS84);
          if (!point) continue;
          const cartographic = C.Cartographic.fromCartesian(point);
          const longitude = C.Math.toDegrees(cartographic.longitude);
          const latitude = C.Math.toDegrees(cartographic.latitude);
          west = Math.min(west, longitude);
          east = Math.max(east, longitude);
          south = Math.min(south, latitude);
          north = Math.max(north, latitude);
          hits += 1;
        }
      }
      if (hits >= 4 && east > west && north > south) return { west, south, east, north };
      return rectangleToBounds(C, rectangle);
    }

    function currentView(): ViewState {
      const bounds = computeVisibleBounds();
      const is3D = viewer.scene.mode === C.SceneMode.SCENE3D;
      const cameraPosition = C.Cartesian3.clone(camera.positionWC);
      const toCamera = new C.Cartesian3();
      // Teste de horizonte (aproximação esférica): o ponto só é visível se a câmera
      // estiver do mesmo lado do plano tangente. Evita marcadores "atravessando" o globo.
      const isVisible = (position: Cesium.Cartesian3) => {
        if (!is3D) return true;
        C.Cartesian3.subtract(cameraPosition, position, toCamera);
        return C.Cartesian3.dot(position, toCamera) > 0;
      };
      return { bounds, cameraHeight: currentHeight(), isVisible };
    }

    function refresh() {
      if (viewer.isDestroyed()) return;
      const view = currentView();
      const items = index.query(view.bounds, heightToZoom(view.cameraHeight));
      const clusterItems: MapCluster[] = [];
      const pointItems: MapPoint[] = [];
      for (const item of items) {
        if (item.kind === "cluster") clusterItems.push(item);
        else if (pointItems.length < MAX_RENDERED_POINTS) pointItems.push(item);
      }

      // A empresa selecionada fica sempre visível, mesmo quando está dentro de um cluster.
      if (selectedId && !pointItems.some((point) => point.companyId === selectedId)) {
        const selectedCompany = companiesById.get(selectedId);
        const location = selectedCompany?.location;
        if (location && boundsContain(view.bounds, location.displayLatitude, location.displayLongitude)) {
          pointItems.push({
            kind: "company",
            companyId: selectedId,
            latitude: location.displayLatitude,
            longitude: location.displayLongitude,
            precision: location.precision
          });
        }
      }

      const showMarkers = mode === "companies";
      const frame: RenderFrame = {
        view,
        clusters: showMarkers ? clusterItems : [],
        points: showMarkers ? pointItems : pointItems.filter((point) => point.companyId === selectedId),
        companiesById,
        selectedId
      };
      clusters.render?.(frame);
      companiesLayer.render?.(frame);

      const zoom = heightToZoom(view.cameraHeight);
      if (mode === "concentration") updateH3(zoom);

      const visible = visibleCompanies(companies, view.bounds);
      options.onViewChange({
        bounds: view.bounds,
        zoom,
        scale: viewScaleForHeight(view.cameraHeight),
        visibleCompanyCount: visible.count,
        visibleCompanyIds: visible.ids,
        clusterCount: showMarkers ? clusterItems.length : 0,
        h3Resolution: mode === "concentration" ? h3Resolution : null,
        legend: mode === "concentration" ? h3Legend : null
      });
    }

    /** Recalcula as colunas H3 só quando a resolução (ou os dados) mudam. */
    function updateH3(zoom: number, force = false) {
      const wanted = Math.min(resolutionForZoom(zoom), maxH3Resolution);
      if (!force && wanted === h3Resolution) return;
      h3Resolution = wanted;
      h3Cells = aggregateCompaniesByH3(companies, wanted);
      const bins = h3Columns.setCells(h3Cells);
      const limited = wanted < resolutionForZoom(zoom);
      h3Legend = legendFromBins(
        `Empresas por célula H3 (resolução ${wanted})`,
        bins,
        limited
          ? `Colunas de ~${describeCellArea(h3Cells[0]?.areaKm2 ?? 36)}: a maioria das empresas tem localização aproximada, então não dividimos em áreas menores.`
          : `Células H3 de ~${describeCellArea(h3Cells[0]?.areaKm2 ?? 0)}; a altura é proporcional à quantidade de empresas.`
      );
    }

    const scheduleRefresh = debounce(refresh, 90);
    stack.defer(() => scheduleRefresh.cancel());

    camera.percentageChanged = 0.15;
    stack.defer(camera.moveEnd.addEventListener(() => scheduleRefresh()));
    stack.defer(camera.changed.addEventListener(() => scheduleRefresh()));
    // Movimento iniciado pelo usuário (não por enquadramento automático) → "Buscar nesta área".
    stack.defer(
      camera.moveStart.addEventListener(() => {
        if (performance.now() < programmaticUntil) return;
        options.onUserMove?.();
      })
    );

    function flyToBounds(bounds: GeoBounds, duration = 1.1) {
      markProgrammatic(duration);
      camera.flyTo({
        destination: C.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
        duration,
        easingFunction: C.EasingFunction.CUBIC_IN_OUT
      });
    }

    function flyToPoint(latitude: number, longitude: number, height: number, duration = 0.9) {
      markProgrammatic(duration);
      camera.flyTo({
        destination: C.Cartesian3.fromDegrees(longitude, latitude, Math.max(height, 400)),
        duration,
        easingFunction: C.EasingFunction.CUBIC_IN_OUT
      });
    }

    /**
     * Vista inicial. Vindo do 2D, o globo abre inclinado (~50°) sobre a mesma área, para
     * que as colunas H3 e o relevo apareçam em perspectiva; em escala nacional fica de cima.
     */
    function setInitialView(bounds: GeoBounds, oblique: boolean) {
      markProgrammatic(0.5);
      const rectangle = C.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
      const straight = C.Cartographic.fromCartesian(camera.getRectangleCameraCoordinates(rectangle));
      const height = straight?.height ?? 0;
      if (!oblique || !Number.isFinite(height) || height <= 0 || height > 2_500_000) {
        camera.setView({ destination: rectangle });
        return;
      }
      const center = C.Rectangle.center(rectangle);
      const tilt = C.Math.toRadians(40);
      const back = (height * 0.9 * Math.tan(tilt)) / 6_371_000;
      camera.setView({
        destination: C.Cartesian3.fromRadians(center.longitude, center.latitude - back, height * 0.9),
        orientation: { heading: 0, pitch: -(Math.PI / 2 - tilt), roll: 0 }
      });
    }

    setInitialView(options.initialBounds ?? BRAZIL_BOUNDS, Boolean(options.initialBounds));

    // Seleção e hover (um único handler, removido no descarte).
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    stack.defer(() => {
      if (!handler.isDestroyed()) handler.destroy();
    });

    function pickTarget(position: Cesium.Cartesian2): PickTarget | null {
      const picked = viewer.scene.pick(position) as { id?: unknown } | undefined;
      const id = picked?.id as PickTarget | undefined;
      if (id && typeof id === "object" && (id.kind === "cluster" || id.kind === "company" || id.kind === "h3")) return id;
      return null;
    }

    handler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
      const target = pickTarget(event.position);
      if (!target) {
        if (selectedId) options.onSelect(null);
        if (selectedRegionId) options.onRegionSelect(null);
        return;
      }
      if (target.kind === "company") {
        options.onSelect(target.companyId);
        return;
      }
      if (target.kind === "h3") {
        const cell = h3Cells.find((item) => item.id === target.cellId);
        if (cell) {
          options.onRegionSelect({
            kind: "h3",
            id: cell.id,
            resolution: cell.resolution,
            companyIds: cell.companyIds,
            latitude: cell.latitude,
            longitude: cell.longitude
          });
        }
        return;
      }
      const expansionZoom = index.expansionZoom(target.clusterId);
      const zoomNow = heightToZoom(currentHeight());
      // Empresas no mesmo ponto (mesmo prédio/CEP) nunca se separam com zoom:
      // entregamos a lista para o painel em vez de aproximar indefinidamente.
      if (expansionZoom > CLUSTER_MAX_ZOOM || zoomNow >= CLUSTER_MAX_ZOOM) {
        options.onGroupSelect(index.leaves(target.clusterId, 100));
        return;
      }
      flyToPoint(target.latitude, target.longitude, Math.min(zoomToHeight(expansionZoom + 0.5), currentHeight() * 0.6));
    }, C.ScreenSpaceEventType.LEFT_CLICK);

    let hoverFrame = 0;
    handler.setInputAction((event: { endPosition: Cesium.Cartesian2 }) => {
      if (hoverFrame) return;
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = 0;
        if (viewer.isDestroyed()) return;
        viewer.scene.canvas.style.cursor = pickTarget(event.endPosition) ? "pointer" : "";
      });
    }, C.ScreenSpaceEventType.MOUSE_MOVE);
    stack.defer(() => {
      if (hoverFrame) window.cancelAnimationFrame(hoverFrame);
    });

    // Teclado: setas movem, +/- aproximam, Esc fecha o painel.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== options.container) return;
      const step = currentHeight() * 0.15;
      switch (event.key) {
        case "ArrowUp":
          camera.moveUp(step);
          break;
        case "ArrowDown":
          camera.moveDown(step);
          break;
        case "ArrowLeft":
          camera.moveLeft(step);
          break;
        case "ArrowRight":
          camera.moveRight(step);
          break;
        case "+":
        case "=":
          camera.zoomIn(currentHeight() * 0.4);
          break;
        case "-":
        case "_":
          camera.zoomOut(currentHeight() * 0.6);
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
      requestRender();
      scheduleRefresh();
    };
    options.container.addEventListener("keydown", onKeyDown);
    stack.defer(() => options.container.removeEventListener("keydown", onKeyDown));

    // Tema claro/escuro: recolore camadas sem recriar o viewer.
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onThemeChange = () => {
      palette = readMapPalette();
      basemap.setTheme(detectTheme());
      viewer.scene.globe.baseColor = C.Color.fromCssColorString(palette.theme === "dark" ? "#1c1c1e" : "#dfe6ee");
      for (const layer of layers) layer.setPalette?.(palette);
      requestRender();
    };
    media?.addEventListener?.("change", onThemeChange);
    stack.defer(() => media?.removeEventListener?.("change", onThemeChange));

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => requestRender()) : null;
    resizeObserver?.observe(options.container);
    stack.defer(() => resizeObserver?.disconnect());

    const engine: BusinessMapEngine = {
      capabilities: { kind: "3d", modes: ["companies", "concentration"], photorealistic: canUsePhotorealistic3D(options.config) },
      setData(next, { fit = false } = {}) {
        companies = next.companies;
        companiesById = new Map(companies.map((company) => [company.id, company]));
        index = createCompanyClusterIndex(companies);
        maxH3Resolution = maxResolutionForPrecision(precisionStats(companies));
        if (selectedId && !companiesById.has(selectedId)) selectedId = null;
        dataBounds = computeDataBounds(companies);
        if (mode === "concentration") updateH3(heightToZoom(currentHeight()), true);
        if (fit && dataBounds) flyToBounds(dataBounds, 1.2);
        refresh();
      },
      setMode(next) {
        // "Regiões" não existe no 3D (capabilities.modes): mostra as empresas.
        const effective: MapLayerMode = next === "regions" ? "companies" : next;
        if (mode === effective) return;
        mode = effective;
        selectedRegionId = null;
        h3Columns.setSelectedCell(null);
        h3Columns.setVisible(effective === "concentration");
        if (effective === "concentration") updateH3(heightToZoom(currentHeight()), true);
        refresh();
      },
      setSelected(companyId) {
        if (selectedId === companyId) return;
        selectedId = companyId;
        refresh();
      },
      setSelectedRegion(regionId) {
        selectedRegionId = regionId;
        h3Columns.setSelectedCell(regionId);
      },
      focusCompany(companyId) {
        const company = companiesById.get(companyId);
        if (!company?.location) return;
        selectedId = companyId;
        const precise = company.location.precision === "exact" || company.location.precision === "address";
        flyToPoint(company.location.displayLatitude, company.location.displayLongitude, precise ? 1_500 : 9_000);
        refresh();
      },
      focusPoint(latitude, longitude, zoom) {
        flyToPoint(latitude, longitude, zoomToHeight(zoom));
      },
      zoomIn() {
        camera.zoomIn(currentHeight() * 0.45);
        requestRender();
        scheduleRefresh();
      },
      zoomOut() {
        camera.zoomOut(currentHeight() * 0.8);
        requestRender();
        scheduleRefresh();
      },
      resetView() {
        flyToBounds(BRAZIL_BOUNDS);
      },
      fitToData() {
        flyToBounds(dataBounds ?? BRAZIL_BOUNDS);
      },
      async setPhotorealistic(enabled) {
        if (!enabled) {
          if (photoreal && !viewer.isDestroyed()) viewer.scene.primitives.remove(photoreal);
          photoreal = null;
          requestRender();
          return false;
        }
        if (photoreal) return true;
        try {
          const tileset = await loadPhotorealistic3D(C, options.config);
          if (stack.disposed || viewer.isDestroyed()) {
            tileset.destroy();
            return false;
          }
          photoreal = viewer.scene.primitives.add(tileset) as Cesium.Cesium3DTileset;
          requestRender();
          return true;
        } catch (error) {
          console.warn("[map] 3D realista indisponível", error instanceof Error ? error.message : error);
          return false;
        }
      },
      getViewBounds() {
        return currentView().bounds;
      },
      destroy() {
        stack.dispose();
      }
    };

    stack.defer(() => {
      if (photoreal && !viewer.isDestroyed()) viewer.scene.primitives.remove(photoreal);
      photoreal = null;
    });

    refresh();
    return engine;
  } catch (error) {
    stack.dispose();
    throw error;
  }
};
