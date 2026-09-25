/**
 * Copia o worker do MapLibre GL (v6, ESM) para public/maplibre.
 *
 * O MapLibre v6 roda o processamento de tiles num Web Worker que importa o arquivo
 * irmão `maplibre-gl-shared.mjs` por caminho relativo. O Turbopack (Next 16) não emite
 * esse irmão ao empacotar o worker, então — como recomenda a documentação do MapLibre
 * (docs/index.md, seção Turbopack) — servimos os dois arquivos do próprio domínio e
 * apontamos `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")` (lib/map/maplibre/engine.ts).
 * Executado em `predev`/`prebuild`; a pasta gerada não é versionada.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let packageDir;
try {
  packageDir = path.dirname(require.resolve("maplibre-gl/package.json", { paths: [root] }));
} catch {
  console.error("[maplibre] pacote 'maplibre-gl' não encontrado. Rode `npm install`.");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
const dist = path.join(packageDir, "dist");
const target = path.join(root, "public", "maplibre");
const marker = path.join(target, ".version");
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

if (existsSync(marker) && readFileSync(marker, "utf8").trim() === version && files.every((file) => existsSync(path.join(target, file)))) {
  console.log(`[maplibre] public/maplibre já está na versão ${version}.`);
  process.exit(0);
}

mkdirSync(target, { recursive: true });
for (const file of files) {
  const from = path.join(dist, file);
  if (!existsSync(from)) {
    console.error(`[maplibre] arquivo não encontrado: ${from}`);
    process.exit(1);
  }
  copyFileSync(from, path.join(target, file));
}
writeFileSync(marker, `${version}\n`);
console.log(`[maplibre] worker ${version} copiado para public/maplibre.`);
