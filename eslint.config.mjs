import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * O Next.js 16 removeu `next lint`; o lint roda com o ESLint diretamente,
 * usando as regras oficiais do Next (core-web-vitals + TypeScript).
 */
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "public/cesium/**", "next-env.d.ts"]
  },
  {
    // Código anterior à adoção do ESLint 9 (o script `next lint` não existia mais no Next 16,
    // então essas regras nunca rodaram). Mantidas como aviso para não alterar comportamento
    // de módulos estáveis fora do escopo; código novo segue as regras como erro.
    files: [
      "app/api/chat/cnae-assistant/route.ts",
      "components/ai-format-processing-panel.tsx",
      "components/search-filter-builder.tsx",
      "components/search-submit-button.tsx",
      "components/site-mobile-nav.tsx",
      "lib/ai-formatting.ts",
      "lib/db-client.ts",
      "lib/discovery/service.ts",
      "tests/casadosdados.test.mts"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn"
    }
  }
];

export default config;
