/**
 * Copia o build oficial do CesiumJS para public/cesium.
 *
 * O Mapa Empresarial carrega o Cesium sob demanda (lib/map/engine/cesium-loader.ts) a partir
 * do próprio domínio: Cesium.js, Workers, Assets (inclui a textura offline Natural Earth II),
 * ThirdParty e Widgets. Executado automaticamente em `predev` e `prebuild`; a pasta gerada
 * não é versionada (.gitignore).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let cesiumPackageDir;
try {
  cesiumPackageDir = path.dirname(require.resolve("cesium/package.json", { paths: [root] }));
} catch {
  console.error("[cesium] pacote 'cesium' não encontrado. Rode `npm install`.");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(path.join(cesiumPackageDir, "package.json"), "utf8"));
const source = path.join(cesiumPackageDir, "Build", "Cesium");
const target = path.join(root, "public", "cesium");
const marker = path.join(target, ".version");

if (!existsSync(source)) {
  console.error(`[cesium] build não encontrado em ${source}.`);
  process.exit(1);
}

if (existsSync(marker) && readFileSync(marker, "utf8").trim() === version) {
  console.log(`[cesium] public/cesium já está na versão ${version}.`);
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of ["Cesium.js", "Workers", "Assets", "ThirdParty", "Widgets"]) {
  const from = path.join(source, entry);
  if (existsSync(from)) cpSync(from, path.join(target, entry), { recursive: true });
}
writeFileSync(marker, `${version}\n`);
console.log(`[cesium] ${version} copiado para public/cesium.`);
