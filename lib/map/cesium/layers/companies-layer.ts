import type * as Cesium from "cesium";
import { ICON_SCALE, createIconCache, type IconCache } from "@/lib/map/cesium/layers/icons";
import type { LayerContext, MapLayer, PickTarget, RenderFrame } from "@/lib/map/cesium/layers/types";
import type { MapPalette } from "@/lib/map/palette";
import { isPreciseLocation } from "@/lib/map/types";

/**
 * Camada "companies": marcadores individuais, seleção e rótulos em zoom próximo.
 *
 * - Marcador cheio: localização do endereço; marcador vazado/tracejado: localização
 *   aproximada (CEP, município ou UF) — nunca apresentada como exata.
 * - Rótulos só aparecem em visão detalhada e com poucos pontos na tela.
 * - Nenhum componente React por empresa: tudo é primitive do Cesium.
 */
const LABEL_MAX_HEIGHT_METERS = 30_000;
const LABEL_MAX_POINTS = 120;
const MAX_LABEL_LENGTH = 28;

function truncate(value: string) {
  return value.length > MAX_LABEL_LENGTH ? `${value.slice(0, MAX_LABEL_LENGTH - 1)}…` : value;
}

export function createCompaniesLayer(context: LayerContext): MapLayer {
  const { C, viewer } = context;
  const billboards = viewer.scene.primitives.add(new C.BillboardCollection({ scene: viewer.scene })) as Cesium.BillboardCollection;
  const labels = viewer.scene.primitives.add(new C.LabelCollection({ scene: viewer.scene })) as Cesium.LabelCollection;
  let palette = context.palette;
  let icons: IconCache = createIconCache(palette);
  let visible = true;
  let lastFrame: RenderFrame | null = null;

  function render(frame: RenderFrame) {
    lastFrame = frame;
    billboards.removeAll();
    labels.removeAll();
    if (!visible) {
      context.requestRender();
      return;
    }

    const showLabels = frame.view.cameraHeight <= LABEL_MAX_HEIGHT_METERS && frame.points.length <= LABEL_MAX_POINTS;
    const labelColor = C.Color.fromCssColorString(palette.label);
    const outlineColor = C.Color.fromCssColorString(palette.bgElevated);

    // Selecionado por último para ficar acima dos demais.
    const ordered = [...frame.points].sort((left, right) =>
      left.companyId === frame.selectedId ? 1 : right.companyId === frame.selectedId ? -1 : 0
    );

    for (const point of ordered) {
      const position = C.Cartesian3.fromDegrees(point.longitude, point.latitude, 0);
      if (!frame.view.isVisible(position)) continue;
      const selected = point.companyId === frame.selectedId;
      const variant = isPreciseLocation(point.precision) ? "precise" : "approximate";
      const icon = icons.company(variant, selected);
      const target: PickTarget = { kind: "company", companyId: point.companyId };

      const billboard = billboards.add({
        position,
        scale: ICON_SCALE,
        verticalOrigin: C.VerticalOrigin.CENTER,
        horizontalOrigin: C.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: target
      });
      billboard.setImage(icon.key, icon.image);

      if (showLabels || selected) {
        const company = frame.companiesById.get(point.companyId);
        if (company) {
          labels.add({
            position,
            text: truncate(company.displayName),
            font: `${selected ? 600 : 500} 12px ${palette.fontFamily}`,
            fillColor: labelColor,
            outlineColor,
            outlineWidth: 3,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: C.VerticalOrigin.TOP,
            horizontalOrigin: C.HorizontalOrigin.CENTER,
            pixelOffset: new C.Cartesian2(0, selected ? 17 : 11),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            id: target
          });
        }
      }
    }
    context.requestRender();
  }

  return {
    id: "companies",
    render,
    setVisible(next) {
      visible = next;
      if (lastFrame) render(lastFrame);
      else {
        billboards.removeAll();
        labels.removeAll();
      }
      context.requestRender();
    },
    setPalette(next: MapPalette) {
      palette = next;
      icons.clear();
      icons = createIconCache(next);
      if (lastFrame) render(lastFrame);
    },
    destroy() {
      icons.clear();
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(billboards);
        viewer.scene.primitives.remove(labels);
      }
    }
  };
}
