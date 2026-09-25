import type * as Cesium from "cesium";
import { CLUSTER_MAX_ZOOM, createCompanyClusterIndex, type CompanyClusterIndex, type MapCluster, type MapPoint } from "@/lib/map/clustering";
import { BRAZIL_BOUNDS, boundsContain, heightToZoom, viewScaleForHeight, zoomToHeight, type ViewScale } from "@/lib/map/geo";
import type { GeoBounds, MapCompany } from "@/lib/map/types";
import { loadCesium, type CesiumModule } from "@/lib/map/engine/cesium-loader";
import { createDisposerStack, debounce } from "@/lib/map/engine/lifecycle";
import { detectTheme, readMapPalette } from "@/lib/map/engine/palette";
import { applyBasemap, canUsePhotorealistic3D, loadPhotorealistic3D, type PublicMapConfig } from "@/lib/map/engine/providers";
import { createBusinessViewer, installTrackpadPinchZoom } from "@/lib/map/engine/viewer";
import { createClustersLayer } from "@/lib/map/engine/layers/clusters-layer";
import { createCompaniesLayer } from "@/lib/map/engine/layers/companies-layer";
import { createDensityLayer } from "@/lib/map/engine/layers/density-layer";
import type { LayerContext, MapLayer, PickTarget, RenderFrame, ViewState } from "@/lib/map/engine/layers/types";

/**
 * Motor do Mapa Empresarial (somente navegador).
 *
 * Responsabilidades: criar/destruir o viewer, orquestrar camadas, índice de clusters,
 * câmera, seleção e eventos. Os componentes React só chamam esta API — o viewer é
 * criado uma única vez e sobrevive a trocas de dados, filtros e modo de camada.
 */
export type MapLayerMode = "companies" | "density";
export type SceneModeOption = "3d" | "2d";

export type MapViewInfo = {
  bounds: GeoBounds;
  cameraHeight: number;
  scale: ViewScale;
  visibleCompanyCount: number;
  /** Primeiras empresas na área visível (alternativa textual acessível ao mapa). */
  visibleCompanyIds: string[];
  clusterCount: number;
};

export type BusinessMapEngineOptions = {
  container: HTMLElement;
  creditContainer: HTMLElement;
  config: PublicMapConfig;
  onSelect(companyId: string | null): void;
  onViewChange(info: MapViewInfo): void;
  /** Cluster que não se separa com zoom (empresas no mesmo ponto). */
  onGroupSelect?(companyIds: string[]): void;
};

export type BusinessMapEngine = {
  setCompanies(companies: MapCompany[], options?: { fit?: boolean }): void;
  setMode(mode: MapLayerMode): void;
  setSelected(companyId: string | null): void;
  focusCompany(companyId: string): void;
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  fitToData(): void;
  setSceneMode(mode: SceneModeOption): void;
  setPhotorealistic(enabled: boolean): Promise<boolean>;
  supportsPhotorealistic: boolean;
  getViewBounds(): GeoBounds;
  destroy(): void;
};

const MAX_RENDERED_POINTS = 3000;
const ACCESSIBLE_LIST_LIMIT = 50;

function rectangleToBounds(C: CesiumModule, rectangle: Cesium.Rectangle | undefined): GeoBounds {
  if (!rectangle) return { west: -180, south: -85, east: 180, north: 85 };
  return {
    west: C.Math.toDegrees(rectangle.west),
    south: C.Math.toDegrees(rectangle.south),
    east: C.Math.toDegrees(rectangle.east),
    north: C.Math.toDegrees(rectangle.north)
  };
}

export async function createBusinessMapEngine(options: BusinessMapEngineOptions, signal: AbortSignal): Promise<BusinessMapEngine> {
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
    const density = createDensityLayer(layerContext);
    const clusters = createClustersLayer(layerContext);
    const companiesLayer = createCompaniesLayer(layerContext);
    const layers: MapLayer[] = [density, clusters, companiesLayer];
    stack.defer(() => {
      for (const layer of layers) layer.destroy();
    });

    let companies: MapCompany[] = [];
    let companiesById = new Map<string, MapCompany>();
    let index: CompanyClusterIndex = createCompanyClusterIndex([]);
    let selectedId: string | null = null;
    let mode: MapLayerMode = "companies";
    let dataBounds: GeoBounds | null = null;
    let photoreal: Cesium.Cesium3DTileset | null = null;

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

      const visibleIds: string[] = [];
      let visibleCount = 0;
      for (const company of companies) {
        const location = company.location;
        if (!location || !boundsContain(view.bounds, location.displayLatitude, location.displayLongitude)) continue;
        visibleCount += 1;
        if (visibleIds.length < ACCESSIBLE_LIST_LIMIT) visibleIds.push(company.id);
      }

      options.onViewChange({
        bounds: view.bounds,
        cameraHeight: view.cameraHeight,
        scale: viewScaleForHeight(view.cameraHeight),
        visibleCompanyCount: visibleCount,
        visibleCompanyIds: visibleIds,
        clusterCount: clusterItems.length
      });
    }

    const scheduleRefresh = debounce(refresh, 90);
    stack.defer(() => scheduleRefresh.cancel());

    camera.percentageChanged = 0.15;
    stack.defer(camera.moveEnd.addEventListener(() => scheduleRefresh()));
    stack.defer(camera.changed.addEventListener(() => scheduleRefresh()));
    // Após trocar 2D/3D o Cesium reposiciona a câmera; voltamos à área que o usuário via.
    let boundsBeforeMorph: GeoBounds | null = null;
    stack.defer(
      viewer.scene.morphComplete.addEventListener(() => {
        if (boundsBeforeMorph) {
          const target = boundsBeforeMorph;
          boundsBeforeMorph = null;
          camera.setView({ destination: C.Rectangle.fromDegrees(target.west, target.south, target.east, target.north) });
        }
        scheduleRefresh();
      })
    );

    function flyToBounds(bounds: GeoBounds, duration = 1.1) {
      camera.flyTo({
        destination: C.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
        duration,
        easingFunction: C.EasingFunction.CUBIC_IN_OUT
      });
    }

    function flyToPoint(latitude: number, longitude: number, height: number, duration = 0.9) {
      camera.flyTo({
        destination: C.Cartesian3.fromDegrees(longitude, latitude, Math.max(height, 400)),
        duration,
        easingFunction: C.EasingFunction.CUBIC_IN_OUT
      });
    }

    camera.setView({
      destination: C.Rectangle.fromDegrees(BRAZIL_BOUNDS.west, BRAZIL_BOUNDS.south, BRAZIL_BOUNDS.east, BRAZIL_BOUNDS.north)
    });

    // Seleção e hover (um único handler, removido no descarte).
    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    stack.defer(() => {
      if (!handler.isDestroyed()) handler.destroy();
    });

    function pickTarget(position: Cesium.Cartesian2): PickTarget | null {
      const picked = viewer.scene.pick(position) as { id?: unknown } | undefined;
      const id = picked?.id as PickTarget | undefined;
      if (id && typeof id === "object" && (id.kind === "cluster" || id.kind === "company")) return id;
      return null;
    }

    handler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
      const target = pickTarget(event.position);
      if (!target) {
        if (selectedId) options.onSelect(null);
        return;
      }
      if (target.kind === "company") {
        options.onSelect(target.companyId);
        return;
      }
      const expansionZoom = index.expansionZoom(target.clusterId);
      const zoomNow = heightToZoom(currentHeight());
      // Empresas no mesmo ponto (mesmo prédio/CEP) nunca se separam com zoom:
      // entregamos a lista para o painel em vez de aproximar indefinidamente.
      if (expansionZoom > CLUSTER_MAX_ZOOM || zoomNow >= CLUSTER_MAX_ZOOM) {
        options.onGroupSelect?.(index.leaves(target.clusterId, 100));
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
          return;
        default:
          return;
      }
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
      supportsPhotorealistic: canUsePhotorealistic3D(options.config),
      setCompanies(next, { fit = false } = {}) {
        companies = next;
        companiesById = new Map(next.map((company) => [company.id, company]));
        index = createCompanyClusterIndex(next);
        density.setCompanies?.(next);
        if (selectedId && !companiesById.has(selectedId)) selectedId = null;

        const located = next.filter((company) => company.location);
        if (located.length > 0) {
          let west = Infinity;
          let east = -Infinity;
          let south = Infinity;
          let north = -Infinity;
          for (const company of located) {
            west = Math.min(west, company.location!.displayLongitude);
            east = Math.max(east, company.location!.displayLongitude);
            south = Math.min(south, company.location!.displayLatitude);
            north = Math.max(north, company.location!.displayLatitude);
          }
          const pad = Math.max((east - west) * 0.12, (north - south) * 0.12, 0.05);
          dataBounds = { west: west - pad, east: east + pad, south: south - pad, north: north + pad };
        } else {
          dataBounds = null;
        }

        if (fit && dataBounds) flyToBounds(dataBounds, 1.2);
        refresh();
      },
      setMode(next) {
        mode = next;
        density.setVisible(next === "density");
        refresh();
      },
      setSelected(companyId) {
        if (selectedId === companyId) return;
        selectedId = companyId;
        refresh();
      },
      focusCompany(companyId) {
        const company = companiesById.get(companyId);
        if (!company?.location) return;
        selectedId = companyId;
        const precise = company.location.precision === "exact" || company.location.precision === "address";
        flyToPoint(company.location.displayLatitude, company.location.displayLongitude, precise ? 1_500 : 9_000);
        refresh();
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
      setSceneMode(next) {
        const scene = viewer.scene;
        const wanted = next === "2d" ? C.SceneMode.SCENE2D : C.SceneMode.SCENE3D;
        if (scene.mode === wanted) return;
        boundsBeforeMorph = computeVisibleBounds();
        if (next === "2d") scene.morphTo2D(0.6);
        else scene.morphTo3D(0.6);
        requestRender();
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
}
