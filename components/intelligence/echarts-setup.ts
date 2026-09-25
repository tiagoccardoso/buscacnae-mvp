/**
 * Registro tree-shaken do Apache ECharts: só o que a Inteligência usa (barras, grade,
 * tooltip, acessibilidade e renderizador SVG). Importado por `import()` dinâmico num
 * ÚNICO módulo — assim o bundler gera um só chunk (imports dinâmicos separados de
 * echarts/core, /charts, /components e /renderers duplicavam o zrender em 3 chunks).
 */
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, GridComponent, TooltipComponent, AriaComponent, SVGRenderer]);

export { echarts };
