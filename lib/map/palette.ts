/**
 * Cores do mapa lidas dos tokens do design system (app/styles/tokens.css).
 * O Cesium desenha em WebGL e não enxerga CSS, então as variáveis são resolvidas
 * uma vez no navegador e reaplicadas quando o tema muda.
 */
export type MapPalette = {
  accent: string;
  accentContrast: string;
  accentSoft: string;
  label: string;
  labelSecondary: string;
  bgElevated: string;
  warning: string;
  success: string;
  theme: "light" | "dark";
  fontFamily: string;
};

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string) {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

export function detectTheme(): "light" | "dark" {
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced === "dark" || forced === "light") return forced;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readMapPalette(element: Element = document.documentElement): MapPalette {
  const styles = getComputedStyle(element);
  return {
    accent: readVar(styles, "--accent", "#0A5CE6"),
    accentContrast: readVar(styles, "--accent-contrast", "#FFFFFF"),
    accentSoft: readVar(styles, "--accent-soft", "rgba(10, 92, 230, 0.12)"),
    label: readVar(styles, "--label", "#1D1D1F"),
    labelSecondary: readVar(styles, "--label-secondary", "#6E6E73"),
    bgElevated: readVar(styles, "--bg-elevated", "#FFFFFF"),
    warning: readVar(styles, "--warning", "#B25000"),
    success: readVar(styles, "--success", "#1E7D32"),
    theme: detectTheme(),
    fontFamily: readVar(styles, "--font-sans", "system-ui, sans-serif")
  };
}

/** Converte qualquer cor CSS em [r, g, b, a] (0..255) usando o próprio canvas. */
export function cssColorToRgba(color: string): [number, number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return [10, 92, 230, 255];
  context.fillStyle = "#000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  return [data[0], data[1], data[2], data[3]];
}
