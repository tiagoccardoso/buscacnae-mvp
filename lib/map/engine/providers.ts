import type * as Cesium from "cesium";
import type { CesiumModule } from "@/lib/map/engine/cesium-loader";

/**
 * Providers de mapa base, desacoplados do restante do mapa.
 *
 * Inspirado no catálogo de fontes do God's Eye View (src/maps/imagery.js,
 * src/maps/google3d.js — MIT, © 2026 Bilawal Sidhu): cada fonte é criada com
 * credenciais explícitas (nunca alterando padrões globais do SDK) e existe sempre
 * um caminho sem chave.
 *
 * Camadas:
 * - Natural Earth II (incluso no build do Cesium, servido do próprio domínio, sem custo
 *   e sem rede externa) fica sempre por baixo — o globo nunca fica vazio.
 * - Mapa de ruas por cima, conforme NEXT_PUBLIC_MAP_BASEMAP:
 *   osm (padrão, sem chave) · carto-light · carto-dark · ion (exige token) · offline.
 * - Opcional: Google Photorealistic 3D Tiles quando houver chave (Map Tiles API) ou token ion.
 */
export type BasemapId = "osm" | "carto-light" | "carto-dark" | "ion" | "offline";

export type PublicMapConfig = {
  basemap: BasemapId;
  cesiumIonToken: string;
  googleMapTilesKey: string;
};

export type BasemapHandle = {
  id: BasemapId;
  /** Aplica o tom do tema (claro/escuro) às camadas raster. */
  setTheme(theme: "light" | "dark"): void;
  dispose(): void;
};

type StreetFactory = (C: CesiumModule, config: PublicMapConfig) => Promise<Cesium.ImageryProvider> | Cesium.ImageryProvider;

const CARTO_CREDIT = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

const STREET_PROVIDERS: Record<Exclude<BasemapId, "offline">, StreetFactory> = {
  osm: (C) =>
    new C.OpenStreetMapImageryProvider({
      url: "https://tile.openstreetmap.org/",
      credit: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }),
  "carto-light": (C) =>
    new C.UrlTemplateImageryProvider({
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      subdomains: ["a", "b", "c", "d"],
      maximumLevel: 19,
      credit: CARTO_CREDIT
    }),
  "carto-dark": (C) =>
    new C.UrlTemplateImageryProvider({
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      subdomains: ["a", "b", "c", "d"],
      maximumLevel: 19,
      credit: CARTO_CREDIT
    }),
  ion: async (C, config) => {
    const token = config.cesiumIonToken.trim();
    if (!token) throw new Error("ion_token_missing");
    return C.IonImageryProvider.fromAssetId(3, { accessToken: token });
  }
};

export function resolveBasemapId(config: PublicMapConfig): BasemapId {
  if (config.basemap === "ion" && !config.cesiumIonToken.trim()) return "osm";
  return config.basemap;
}

export async function applyBasemap(C: CesiumModule, viewer: Cesium.Viewer, config: PublicMapConfig): Promise<BasemapHandle> {
  const layers: Cesium.ImageryLayer[] = [];
  let street: Cesium.ImageryLayer | null = null;
  let disposed = false;

  const base = await C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl("Assets/Textures/NaturalEarthII"));
  if (viewer.isDestroyed()) throw new Error("viewer_destroyed");
  layers.push(viewer.imageryLayers.addImageryProvider(base, 0));

  let id = resolveBasemapId(config);
  if (id !== "offline") {
    try {
      const provider = await STREET_PROVIDERS[id](C, config);
      if (!viewer.isDestroyed()) {
        street = viewer.imageryLayers.addImageryProvider(provider);
        layers.push(street);
      }
    } catch (error) {
      console.warn("[map] mapa base indisponível; usando camada offline", error instanceof Error ? error.message : error);
      id = "offline";
    }
  }

  return {
    id,
    setTheme(theme) {
      if (!street || disposed) return;
      const dark = theme === "dark" && id !== "carto-dark";
      street.saturation = dark ? 0.2 : 0.55;
      street.brightness = dark ? 0.55 : 1.02;
      street.contrast = dark ? 1.15 : 1.0;
      street.gamma = dark ? 1.1 : 1.0;
      viewer.scene.requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (viewer.isDestroyed()) return;
      for (const layer of layers) viewer.imageryLayers.remove(layer, true);
    }
  };
}

/** Disponível somente quando há credencial configurada (nunca obrigatório). */
export function canUsePhotorealistic3D(config: PublicMapConfig) {
  return Boolean(config.googleMapTilesKey.trim() || config.cesiumIonToken.trim());
}

/** Google Photorealistic 3D Tiles: direto (chave Map Tiles API) ou via Cesium ion (asset 2275207). */
export async function loadPhotorealistic3D(C: CesiumModule, config: PublicMapConfig): Promise<Cesium.Cesium3DTileset> {
  const googleKey = config.googleMapTilesKey.trim();
  if (googleKey) {
    return C.createGooglePhotorealistic3DTileset({ key: googleKey, onlyUsingWithGoogleGeocoder: true });
  }
  const ionToken = config.cesiumIonToken.trim();
  if (!ionToken) throw new Error("photoreal_credentials_missing");
  const resource = await C.IonResource.fromAssetId(2275207, { accessToken: ionToken });
  return C.Cesium3DTileset.fromUrl(resource);
}
