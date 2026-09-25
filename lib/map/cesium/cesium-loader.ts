import type * as CesiumNamespace from "cesium";

/**
 * Carregamento do CesiumJS somente no navegador.
 *
 * O Cesium não é empacotado pelo Next.js: o build oficial (`node_modules/cesium/Build/Cesium`)
 * é copiado para `public/cesium` (scripts/copy-cesium-assets.mjs, executado em predev/prebuild)
 * e carregado sob demanda por <script>, apenas quando o mapa é aberto.
 *
 * Vantagens: nenhum código do Cesium roda no servidor (sem `window is not defined` nem
 * hydration mismatch), nenhum ajuste de bundler, Workers/Assets servidos pelo próprio
 * domínio e ~0 KB adicionados às demais páginas. Os tipos vêm do pacote `cesium`.
 */
export type CesiumModule = typeof CesiumNamespace;

declare global {
  interface Window {
    Cesium?: CesiumModule;
    CESIUM_BASE_URL?: string;
  }
}

export const CESIUM_BASE_URL = "/cesium/";
const SCRIPT_ID = "buscacnae-cesium-runtime";
const STYLE_ID = "buscacnae-cesium-widgets";

let loading: Promise<CesiumModule> | null = null;

function ensureStylesheet() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = `${CESIUM_BASE_URL}Widgets/widgets.css`;
  document.head.appendChild(link);
}

export function loadCesium(): Promise<CesiumModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("O mapa só pode ser carregado no navegador."));
  }
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (loading) return loading;

  window.CESIUM_BASE_URL = CESIUM_BASE_URL;
  ensureStylesheet();

  loading = new Promise<CesiumModule>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");

    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      if (window.Cesium) resolve(window.Cesium);
      else reject(new Error("cesium_unavailable"));
    };
    const onError = () => {
      cleanup();
      script.remove();
      reject(new Error("cesium_load_failed"));
    };

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = `${CESIUM_BASE_URL}Cesium.js`;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    // Permite nova tentativa (ex.: rede instável) em vez de memorizar a falha.
    loading = null;
    throw error;
  });

  return loading;
}
