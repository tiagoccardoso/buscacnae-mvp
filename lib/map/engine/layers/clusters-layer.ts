import type * as Cesium from "cesium";
import { ICON_SCALE, createIconCache, type IconCache } from "@/lib/map/engine/layers/icons";
import type { LayerContext, MapLayer, PickTarget, RenderFrame } from "@/lib/map/engine/layers/types";
import type { MapPalette } from "@/lib/map/engine/palette";

/**
 * Camada "clusters": bolhas com a contagem de empresas agrupadas.
 * Um único BillboardCollection (um draw call) redesenhado apenas quando o
 * viewport muda (moveEnd) ou os dados mudam.
 */
export function createClustersLayer(context: LayerContext): MapLayer {
  const { C, viewer } = context;
  const collection = viewer.scene.primitives.add(new C.BillboardCollection({ scene: viewer.scene })) as Cesium.BillboardCollection;
  let icons: IconCache = createIconCache(context.palette);
  let visible = true;
  let lastFrame: RenderFrame | null = null;

  function render(frame: RenderFrame) {
    lastFrame = frame;
    collection.removeAll();
    if (!visible) return;

    for (const cluster of frame.clusters) {
      const position = C.Cartesian3.fromDegrees(cluster.longitude, cluster.latitude, 0);
      if (!frame.view.isVisible(position)) continue;
      const icon = icons.cluster(cluster.count, cluster.count > 0 ? cluster.approximate / cluster.count : 0);
      const billboard = collection.add({
        position,
        scale: ICON_SCALE,
        verticalOrigin: C.VerticalOrigin.CENTER,
        horizontalOrigin: C.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: {
          kind: "cluster",
          clusterId: cluster.clusterId,
          latitude: cluster.latitude,
          longitude: cluster.longitude
        } satisfies PickTarget
      });
      // Tamanho vem do canvas (2x) e `scale` o traz ao tamanho real em pixels.
      billboard.setImage(icon.key, icon.image);
    }
    context.requestRender();
  }

  return {
    id: "clusters",
    render,
    setVisible(next) {
      visible = next;
      if (lastFrame) render(lastFrame);
      else collection.removeAll();
      context.requestRender();
    },
    setPalette(palette: MapPalette) {
      icons.clear();
      icons = createIconCache(palette);
      if (lastFrame) render(lastFrame);
    },
    destroy() {
      icons.clear();
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(collection);
    }
  };
}
