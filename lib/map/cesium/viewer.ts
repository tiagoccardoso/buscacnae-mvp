import type * as Cesium from "cesium";
import type { CesiumModule } from "@/lib/map/cesium/cesium-loader";

/**
 * Criação do viewer e gestos.
 *
 * `createBusinessViewer` é adaptado de `createApplicationViewer` (src/app/viewer.js)
 * e `installTrackpadPinchZoom` é portado do mesmo arquivo do God's Eye View
 * (MIT, © 2026 Bilawal Sidhu). Mudanças: TypeScript, globo visível por padrão,
 * requestRenderMode ligado desde o início (ideia do "render governor" do projeto
 * original: o mapa só redesenha quando algo muda) e limites de zoom para o Brasil.
 */
export function createBusinessViewer(C: CesiumModule, container: HTMLElement, creditContainer: HTMLElement) {
  const viewer = new C.Viewer(container, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: false,
    infoBox: false,
    // Nenhuma camada padrão: evita requisições implícitas ao Cesium ion.
    baseLayer: false,
    creditContainer,
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    scene3DOnly: false,
    orderIndependentTranslucency: false,
    contextOptions: { webgl: { alpha: false, antialias: true, powerPreference: "high-performance" } }
  });

  try {
    const scene = viewer.scene;
    scene.globe.show = true;
    scene.globe.enableLighting = false;
    scene.globe.showGroundAtmosphere = true;
    scene.globe.baseColor = C.Color.fromCssColorString("#dfe6ee");
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    scene.fog.enabled = true;
    scene.highDynamicRange = false;
    scene.postProcessStages.fxaa.enabled = true;

    const controller = scene.screenSpaceCameraController;
    controller.minimumZoomDistance = 120;
    controller.maximumZoomDistance = 22_000_000;
    controller.inertiaSpin = 0.85;
    controller.inertiaTranslate = 0.85;
    controller.inertiaZoom = 0.75;

    // Sem relógio animado: nada no mapa depende do tempo simulado.
    viewer.clock.shouldAnimate = false;
    return viewer;
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}

const PINCH_ZOOM_MULTIPLIER = 8;
const MAX_PINCH_PIXEL_DELTA = 120;

function boundedPinchDelta(delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return delta;
  return Math.sign(delta) * Math.min(Math.abs(delta) * PINCH_ZOOM_MULTIPLIER, MAX_PINCH_PIXEL_DELTA);
}

/**
 * Pinça do trackpad (Ctrl+wheel no navegador) como zoom do Cesium.
 * Retorna o descarte que remove o listener e restaura a configuração.
 */
export function installTrackpadPinchZoom(C: CesiumModule, viewer: Cesium.Viewer) {
  const controller = viewer.scene.screenSpaceCameraController;
  const container = viewer.container as HTMLElement;
  const canvas = viewer.canvas;

  const originalZoomEventTypes = controller.zoomEventTypes as unknown;
  const zoomEventTypes: unknown[] = Array.isArray(originalZoomEventTypes)
    ? originalZoomEventTypes
    : originalZoomEventTypes === undefined
      ? []
      : [originalZoomEventTypes];
  const alreadyHandlesControlWheel = zoomEventTypes.some((binding) => {
    const candidate = binding as { eventType?: unknown; modifier?: unknown } | null;
    return candidate?.eventType === C.CameraEventType.WHEEL && candidate?.modifier === C.KeyboardEventModifier.CTRL;
  });
  const configuredZoomEventTypes = alreadyHandlesControlWheel
    ? originalZoomEventTypes
    : [...zoomEventTypes, { eventType: C.CameraEventType.WHEEL, modifier: C.KeyboardEventModifier.CTRL }];
  if (!alreadyHandlesControlWheel) {
    controller.zoomEventTypes = configuredZoomEventTypes as typeof controller.zoomEventTypes;
  }

  const relayedEvents = new WeakSet<Event>();
  const relayPinch = (event: WheelEvent) => {
    if (!event.ctrlKey || relayedEvents.has(event) || event.deltaMode !== 0 || !Number.isFinite(event.deltaY) || event.deltaY === 0) {
      return;
    }
    let relayed: WheelEvent;
    try {
      relayed = new WheelEvent("wheel", {
        deltaX: event.deltaX,
        deltaY: boundedPinchDelta(event.deltaY),
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        view: window
      });
    } catch {
      return;
    }
    relayedEvents.add(relayed);
    event.preventDefault();
    event.stopPropagation();
    canvas.dispatchEvent(relayed);
  };

  container.addEventListener("wheel", relayPinch, { capture: true, passive: false });

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    container.removeEventListener("wheel", relayPinch, true);
    if (!alreadyHandlesControlWheel && !viewer.isDestroyed()) {
      controller.zoomEventTypes = originalZoomEventTypes as typeof controller.zoomEventTypes;
    }
  };
}
