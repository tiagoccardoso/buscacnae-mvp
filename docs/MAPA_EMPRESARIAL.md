# Mapa Empresarial

Módulo geográfico do BuscaCNAE. Mostra os **mesmos resultados, filtros e regras de liberação** da busca oficial (Casa dos Dados) em três visões: **Lista**, **Mapa** e **Inteligência**. Não tem base empresarial própria e não faz uma segunda integração com a Casa dos Dados.

- Resultado de uma busca: `/dashboard/search/[id]` com `[ Lista ] [ Mapa ] [ Inteligência ]` (`?view=mapa` / `?view=inteligencia`).
- Página dedicada: `/dashboard/mapa` (seletor de buscas + `[ Mapa ] [ Inteligência ]`).
- Validação local sem login, banco ou Casa dos Dados: `/dev/mapa?n=100|1000|10000|20000|50000` (ver §11).

Status (Fase 2, 25/09/2026): lint (0 erros), typecheck, 106 testes e build verdes.

## 1. Arquitetura

```
Casa dos Dados (POST /v5/cnpj/pesquisa + GET /v4/cnpj/{cnpj})
      ↓  lib/discovery/providers/casadosdados.ts      única integração
      ↓  lib/discovery/service.ts (prepareSearchOrder) cache, filtros, persistência
establishments + search_results (Neon)
      ↓  lib/company-model.ts                         modelo Company (Fase 1)
      ├── Lista ─────────── CompanyListItem → components/results/company-results-table.tsx
      └── Mapa ──────────── CompanySummary → lib/map/service.ts → GET /api/map/searches/[id]
                                  │   (MapCompany: mesmo Company, sem contatos nem payload)
                    ┌─────────────┼───────────────────────────┐
                 2D (padrão)   análise                    3D (opcional)
          MapLibre + deck.gl   H3 + indicadores           CesiumJS
          lib/map/maplibre/*   lib/map/intelligence/*     lib/map/cesium/*
```

O navegador conversa com um **contrato único de motor** (`lib/map/engine-contract.ts`): `setData`, `setMode`, `setSelected`, `setSelectedRegion`, `focusCompany`, `focusPoint`, `zoomIn/zoomOut`, `fitToData`, `resetView`, `getViewBounds`, `destroy`. O motor é criado **uma vez** por montagem (ou por troca 2D ↔ 3D) e recebe dados, camada, seleção e câmera por métodos. Nenhum componente React por empresa.

### O que é compartilhado entre Lista e Mapa

| Item | Onde | Como |
|---|---|---|
| Consulta | `search_queries` / `search_results` | as três visões leem a mesma busca salva; trocar de visão nunca chama a Casa dos Dados |
| Modelo | `lib/company-model.ts` | `CompanyListItem` (lista) e `CompanySummary → MapCompany` (mapa) saem do mesmo `Company` |
| Filtros | `lib/results/company-table-model.ts` | regra única `subjectMatchesFilters`; o mapa converte `MapCompany` no mesmo "sujeito de filtro" (`lib/map/filters.ts`). Teste garante resultado idêntico |
| Estado | URL: `q`, `situacao`, `contato`, `uf`, `unidade` (+ `camada`, `empresa` no mapa) | `lib/results/filter-params.ts`; `history.replaceState` sem navegar; os links Lista/Mapa/Inteligência carregam o recorte |
| Regras/permissões | `lib/map/service.ts` | mesma liberação da lista (amostra de 1 empresa antes da compra), rota autenticada, `Cache-Control: private, no-store` |

Fluxos: **lista → mapa** (botão "Ver no mapa" em cada linha: `?view=mapa&empresa={id}` + filtros; o mapa abre focado na empresa) e **mapa → lista** ("Ver na lista" no painel: `?q={CNPJ}`; a tabela já abre filtrada). "Ver empresa" abre a ficha existente (`/dashboard/companies/[cnpj]`).

### Arquivos

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Contrato | `lib/map/engine-contract.ts` | interface comum 2D/3D, `MapViewInfo`, legenda |
| Tipos | `lib/map/types.ts` | `MapCompany`, `CompanyLocation`, precisões, camadas, seleção de região |
| Config | `lib/map/config.ts` | `PublicMapConfig`, sanitização da URL de estilo |
| Filtros | `lib/map/filters.ts`, `lib/results/filter-params.ts` | filtros da lista aplicados ao mapa; codec da URL |
| Viewport | `lib/map/view-model.ts` | enquadramento, contagem visível, legenda |
| Clusters | `lib/map/clustering.ts` | índice `supercluster` (compartilhado 2D/3D) |
| Inteligência | `lib/map/intelligence/{h3-grid,region-stats,color-scale}.ts` | H3, indicadores, municípios, escala por quantis |
| 2D | `lib/map/maplibre/{engine,styles}.ts` | MapLibre + deck.gl, mapas base |
| 3D | `lib/map/cesium/*` | viewer, providers, clusters, pontos, colunas H3 |
| Ciclo de vida | `lib/map/lifecycle.ts`, `lib/map/palette.ts` | pilha de descarte, debounce, cores dos tokens |
| Servidor | `lib/map/service.ts`, `lib/map/json-response.ts` | dados por busca, sedes municipais, JSON com gzip |
| Localização | `lib/geo/company-location.ts`, `lib/geo/company-location-cache.ts`, `lib/geo/postal-code-geocoder.ts`, `lib/geo/municipalities.ts` | estratégia de coordenadas |
| API | `app/api/map/searches/[id]`, `app/api/map/area-search` | JSON autenticado |
| UI | `components/map/*` | workspace, canvas, filtros, painel da empresa, indicadores, alternância |
| Estilo | `app/styles/map.css` | somente tokens do design system |

## 2. Bibliotecas e decisões

Cópias locais analisadas em `D:\BuscaCNAE` (README, LICENSE, package.json e código). Nada foi copiado para o projeto: as bibliotecas entram como dependências npm estáveis (as cópias locais estão em versões alpha/beta de desenvolvimento).

| Projeto (pasta) | Licença | Versão local | Uso no BuscaCNAE |
|---|---|---|---|
| MapLibre GL JS (`maplibre-gl-js`) | BSD-3-Clause | 6.11.2 | **Dependência** `maplibre-gl@^6.11.2`: mapa operacional 2D. Da documentação local (`docs/index.md`, seção Turbopack) veio a solução do worker (§3). |
| deck.gl (`deck.gl`) | MIT | 9.4.0-beta.4 | **Dependência** `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/maplibre` `~9.4.0`: camadas de dados na GPU. `@deck.gl/maplibre` (`MapLibreOverlay`) é a integração recomendada no próprio repositório para MapLibre v6. |
| H3-js (`h3-js`) | Apache-2.0 | 4.5.0 | **Dependência** `h3-js@^4.5.0`: células hexagonais (`latLngToCell`, `cellToBoundary`, `cellArea`). |
| react-map-gl (`react-map-gl`) | MIT | 8.1.0-alpha.2 | **Não usado** (decisão abaixo). |
| Kepler.gl (`kepler.gl`) | MIT | 3.3.0-alpha.13 | **Somente referência de UX** (§6). |
| God's Eye View (`gods-eye-view`) | MIT © 2026 Bilawal Sidhu | 0.1.1 | **Referência de conceitos** para o 3D (§7). Nenhum dataset copiado. |

**Por que não react-map-gl.** O mapa segue o padrão "motor imperativo + contrato" que já existia no Cesium: o React não re-renderiza a cada movimento de câmera e 2D/3D trocam de motor sem mudar a UI. O react-map-gl é ótimo para mapas declarativos, mas aqui exigiria um segundo modelo de integração (componentes `<Map>`/`useControl`) só para o 2D, sem ganho de performance — deck.gl e MapLibre já são usados diretamente, como o próprio exemplo do repositório (`useControl(() => new MapboxOverlay(props))`) faz por baixo. Lições aplicadas do código do react-map-gl: remover o mapa no desmonte, manter callbacks em `ref` para não recriar o mapa, reaproveitar o `ResizeObserver` interno do MapLibre.

**Por que deck.gl em modo sobreposto (`interleaved: false`).** As camadas de dados ficam sempre acima do mapa base e o deck.gl não depende do estilo do MapLibre: trocar o mapa base (tema claro/escuro, estilo próprio, fallback offline) não derruba as camadas. O modo intercalado só compensaria para misturar rótulos do mapa com as camadas.

**Por que `PolygonLayer` e não `H3HexagonLayer`.** O `H3HexagonLayer` exige `@deck.gl/geo-layers` (e dependências de loaders/mesh). Com no máximo alguns milhares de células por resolução, o `PolygonLayer` de `@deck.gl/layers` com o contorno de `cellToBoundary` tem o mesmo resultado, com menos código enviado ao navegador — e o mesmo agregado H3 alimenta as colunas do 3D.

## 3. Mapa 2D (MapLibre + deck.gl)

- **Worker do MapLibre v6.** O MapLibre v6 é ESM e roda o processamento de tiles num worker que importa `maplibre-gl-shared.mjs` por caminho relativo; o Turbopack (Next 16) não emite esse arquivo. `scripts/copy-maplibre-worker.mjs` copia os dois arquivos para `public/maplibre/` em `predev`/`prebuild` (pasta não versionada) e o motor chama `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`.
- **Carregamento.** O canvas é `next/dynamic({ ssr: false })` e cada motor é um `import()` separado: MapLibre + deck.gl + H3 só baixam quando o mapa abre; o Cesium só quando o usuário pede o 3D.
- **Estilo antes dos tiles.** O motor espera `style.load` (não os tiles): tiles lentos ou bloqueados não atrasam as empresas. Se o estilo externo falhar (rede, cota, CORS) ou demorar 10 s, cai para um fundo local e as camadas continuam funcionando.
- **Interação.** Pan, zoom (roda, pinça, duplo toque, teclado), clique/toque com raio de seleção de 8 px, tooltip no padrão do design system, cursor de "clique" sobre elementos. Sem rotação/inclinação no 2D (evita desorientação no touch).
- **Teclado.** Contêiner focável (`role="application"`): setas movem, `+`/`−` aproximam, `Esc` fecha painéis. O painel lateral repete as empresas visíveis em texto.
- **Clusters.** Mesmo índice `supercluster` do 3D, consultado só no `moveend` (debounce 60 ms). Clique no grupo aproxima até ele se separar; grupos que nunca se separam (mesmo CEP/município) abrem a lista "N empresas neste ponto".
- **Seleção.** Painel da empresa (desktop: à direita, sem cobrir os controles; mobile: bottom sheet). Ao focar, o alvo é deslocado para não ficar atrás do painel.
- **Enquadramento automático.** Uma vez por busca (`fitBounds` com folga). Trocar 2D ↔ 3D mantém a área vista. Deep link com `empresa=` foca a empresa em vez de enquadrar tudo.

### Camadas deck.gl

| Camada | Layer | Quando |
|---|---|---|
| `clusters` + `cluster-counts` | `ScatterplotLayer` + `TextLayer` (atlas só com dígitos) | Empresas |
| `companies` | `ScatterplotLayer` — ponto cheio = endereço; **anel vazado = aproximada** | Empresas |
| `company-names` | `TextLayer` (até 150 rótulos, zoom ≥ 13) | Empresas |
| `selected-company` | `ScatterplotLayer` (anel de seleção) | Empresas |
| `h3-cells` + `h3-counts` | `PolygonLayer` + `TextLayer` (zoom ≥ 7, ≤ 600 células) | Concentração |
| `regions` + `region-counts` + `region-names` | `ScatterplotLayer` + `TextLayer` (rótulos só onde cabem) | Regiões |

`IconLayer` e `GeoJsonLayer` não foram usados: círculos resolvem os marcadores sem atlas de ícones, e não há geometrias GeoJSON (limites municipais) no projeto (§12).

### Mapas base (2D)

| `NEXT_PUBLIC_MAP_BASEMAP` | Fonte | Observação |
|---|---|---|
| `osm` (padrão) | tile.openstreetmap.org (raster) | sem chave; política de uso do OSM (uso leve, atribuição) |
| `carto-light` / `carto-dark` | CARTO raster | sem chave; acompanha o tema claro/escuro; termos da CARTO |
| `ion` | — | exclusivo do 3D; no 2D usa `osm` |
| `offline` | fundo local | sem rede externa |

`NEXT_PUBLIC_MAP_STYLE_URL` (opcional) aceita um estilo MapLibre vetorial próprio (MapTiler, Stadia, OpenFreeMap, servidor próprio) e substitui o catálogo no 2D. No tema escuro, os tiles raster do OSM são escurecidos por `raster-*` paint properties (sem recriar o mapa).

## 4. Inteligência territorial (H3)

Camadas: `[ Empresas ] [ Concentração ] [ Regiões ]`.

- **Concentração.** Cada empresa é atribuída à célula H3 da sua coordenada **real** (`location.latitude/longitude`), nunca à posição espalhada usada para desenhar os marcadores. A resolução acompanha o zoom (3 → 9) e é **limitada pela precisão dos dados** (`maxResolutionForPrecision`): ≥ 80% com ponto (exata/endereço) → até 9; ≥ 80% com CEP ou melhor → até 8; caso contrário (maioria por sede municipal, como hoje) → até 6 (~36 km², escala municipal). A legenda avisa quando a resolução foi limitada. O agregado é refeito só quando os dados ou a resolução mudam (cache por resolução).
- **Regiões.** Um círculo por município, na **sede IBGE** (base local `data/municipios-geo.json`), com a contagem pelo município do cadastro. A chave é o código IBGE, resolvido por código ou por nome + UF — "3509502" e "CAMPINAS/SP" são a mesma região. Empresas sem município identificado ficam fora desta camada (a legenda informa quantas) e continuam na lista.
- **Escala de cor.** Classes por quantil (como o "quantile" do Kepler.gl) numa rampa de um só matiz (fundo → `--accent`): um outlier (capital) não apaga as demais células.

### Indicadores ao selecionar uma região

Calculados em `lib/map/intelligence/region-stats.ts` **somente** com campos que a Casa dos Dados devolveu para as empresas da busca:

| Indicador | Regra |
|---|---|
| Quantidade de empresas | empresas da região que passam pelos filtros atuais |
| Empresas ativas | situação "ATIVA"; sem situação = "não informada" e fora do percentual |
| Novas empresas | abertura nos últimos 12 meses (data do cálculo); só entre as que têm data de abertura |
| Principais CNAEs | top 5 do CNAE principal + total de CNAEs distintos; sem CNAE = contado à parte |
| Distribuição por porte | contagem e % entre as que têm porte informado |
| Precisão | quantas têm localização aproximada (CEP, município, UF) |

Percentual sem denominador é "—", nunca "0%". Não há estimativas para empresas fora da busca (a base é o resultado carregado). A visão **Inteligência** abre em Concentração com o panorama do recorte filtrado e o ranking de municípios (clique foca o município e abre os indicadores).

## 5. Mapa 3D opcional (CesiumJS)

Botão **3D** nos controles. O Cesium não faz parte do mapa operacional: é baixado só nesse momento (`public/cesium`, copiado em `predev`/`prebuild`, como na Fase 1) e o 2D continua sendo o padrão.

- Abre **inclinado (~50°) sobre a mesma área** que o 2D mostrava; em escala nacional abre de cima.
- Camadas: **Empresas** (clusters + pontos, mesmos índices do 2D) e **Concentração** como **colunas H3 extrudadas** (altura linear à quantidade, um único `Primitive`, recriado só quando dados/resolução/seleção mudam). "Regiões" fica desabilitada no 3D (indicado na UI).
- Mapa base: Natural Earth II local por baixo + OSM/CARTO/ion por cima; relevo/edifícios fotorrealistas (Google 3D Tiles) só quando há `NEXT_PUBLIC_GOOGLE_MAP_TILES_KEY` ou token ion.
- `requestRenderMode`: o globo só redesenha quando algo muda.

### Conceitos reaproveitados do God's Eye View

| God's Eye View | BuscaCNAE | Tipo |
|---|---|---|
| `src/app/viewer.js` → `createApplicationViewer`, `installTrackpadPinchZoom` | `lib/map/cesium/viewer.ts` | adaptado/portado (Fase 1) |
| `src/app/application.js` (`defer(cleanup)` + AbortSignal) | `lib/map/lifecycle.ts` — usado pelos **dois** motores | adaptado |
| `src/renderGovernor.js` (render sob demanda) | `requestRenderMode` + `requestRender()` | ideia |
| `src/maps/imagery.js`, `src/maps/google3d.js` (providers com credenciais explícitas) | `lib/map/cesium/providers.ts`, `lib/map/maplibre/styles.ts` | adaptado; caminho sem chave sempre existe |
| contrato de camadas `init/enable/disable/update/destroy` (`src/layers/*`) | `lib/map/cesium/layers/*` e o contrato de motor | simplificado |
| entities/clustering de pontos | BillboardCollection + supercluster (um draw call) | ideia; sem `Entity` por empresa |

Não reutilizado: aplicação Vite, UI, dados ao vivo, datasets (o `LICENSE` exclui os dados do MIT), tiles pagos por padrão.

## 6. Kepler.gl como referência de UX

Estudados `src/layers/*` (point, cluster, h3-hexagon, hexagon, heatmap, geojson), `docs/user-guides/{e-filters,g-interactions,c-types-of-layers}`. Aplicado:

- **Camadas como "visões" do mesmo dataset**: Empresas/Concentração/Regiões leem os mesmos dados filtrados; os filtros valem para todas as camadas (como os filtros por coluna do Kepler valem para todas as camadas do dataset).
- **Tooltip no hover e clique para fixar**: tooltip leve do deck.gl; o clique "fixa" abrindo o painel da empresa/região.
- **Escala por quantil + legenda com classes** e aviso de leitura (resolução H3 limitada, sede municipal).
- **Sem incorporar a aplicação**: Redux, DuckDB, gerenciamento de datasets e editor de camadas não fazem sentido num produto com um dataset por busca.

## 7. Geolocalização e precisão

A Casa dos Dados devolve, em `endereco.ibge`, a **latitude/longitude da sede do município** (IBGE) — não a do estabelecimento. A pesquisa aceita `uf`, `municipio`, `bairro` e `cep`, mas **não** latitude/longitude, raio ou retângulo.

Estratégia (`lib/geo/company-location.ts`), em ordem:

1. **coordenada confiável existente**: coordenadas do próprio endereço na fonte (hoje a Casa dos Dados não envia; se enviar, entram aqui) → `address`;
2. **cache por empresa** (`establishment_locations`, opcional): ponto verificado (`exact`) ou geocodificado a partir do endereço (`address`);
3. **endereço geocodificado**: só alimenta o cache do passo 2. **Nenhum geocodificador de endereço está ligado** (custo e termos de uso de Google/HERE/Mapbox/Nominatim); a tabela existe para uma integração futura sem mudar o mapa;
4. **CEP**: cache `postal_code_locations` (+ geocodificação controlada opcional via BrasilAPI, desligada por padrão) → `postal_code`;
5. **município**: `endereco.ibge` da Casa dos Dados ou sede IBGE pela base local → `city`;
6. **UF**: centro do estado → `approximate`; sem nada → fora do mapa (continua na lista, contada no painel).

| Precisão | Rótulo | Desenho |
|---|---|---|
| `exact` | Localização exata | ponto cheio |
| `address` | Endereço | ponto cheio |
| `postal_code` | Região do CEP | anel vazado, espalhado ≤ 250 m |
| `city` | Centro do município | anel vazado, espalhado ≤ 2,5 km |
| `approximate` | Aproximada (estado) | anel vazado, espalhado ≤ 25 km |

**Nunca representamos localização aproximada como exata**: marcador vazado + legenda, aviso no painel lateral, nota no painel da empresa ("O ponto não indica o endereço exato"), rótulo "aproximada" na lista acessível, tooltip, e a análise H3 usa a coordenada real (sem o espalhamento visual) com resolução limitada pela precisão. Migração opcional: `sql/neon_map_locations.sql` (tabelas `postal_code_locations` e `establishment_locations`).

## 8. Buscar nesta área

Botão **Buscar nesta área** — aparece só depois que o **usuário** move o mapa (enquadramentos automáticos não contam) e pede confirmação. Nunca dispara por movimento de câmera.

1. o navegador envia o retângulo visível (`POST /api/map/area-search`, com `AbortController`);
2. o servidor converte o retângulo em **municípios cuja sede está na área** (filtro suportado pela Casa dos Dados);
3. área > 250.000 km² ou mais de `MAP_AREA_SEARCH_MAX_CITIES` municípios → "Aproxime o mapa…";
4. executa `prepareSearchOrder` com os mesmos CNAEs e filtros, trocando só a localidade (mesma função da busca normal, com cancelamento);
5. abre a nova busca na mesma visão (Mapa ou Inteligência); ela fica no histórico e segue a regra de compra.

Não simulamos filtro por coordenada: a fonte não oferece, e a precisão predominante é municipal.

## 9. Performance

Medido com dados sintéticos que passam pelo pipeline real do servidor (`buildMapCompanies` → localização → espalhamento). Node 22, `npm test`:

| Empresas | Modelo (servidor) | Índice de clusters | 14 consultas de viewport | H3 (res. 6) | Indicadores | Filtros |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 1 ms | 11 ms | 1 ms | 6 ms | 1 ms | 0 ms |
| 1.000 | 6 ms | 15 ms | 8 ms | 19 ms | 3 ms | 7 ms |
| 10.000 | 47 ms | 46 ms | 33 ms | 31 ms | 15 ms | 28 ms |
| 50.000 | 402 ms | 168 ms | 79 ms | 79 ms | 49 ms | 128 ms |

Navegador (build de produção, Chromium headless **com GPU por software** — em GPU real os tempos de desenho são menores; tiles externos bloqueados no ambiente de teste):

| Empresas | Pronto (dados + mapa) | Dados transferidos (gzip) | Troca de camada (após a 1ª) | Filtro | Heap JS |
|---:|---:|---:|---:|---:|---:|
| 100 | 2,5–5 s | 11 KB | 0,3–0,4 s | 27 ms | 51 MB |
| 1.000 | 2,5–3,5 s | 90 KB | 0,3–0,4 s | 37 ms | 55 MB |
| 10.000 | 2,5–4 s | 836 KB | 0,3–0,4 s | 67–105 ms | 66–74 MB |
| 50.000 | 2,5–3,5 s | 4,1 MB | 0,3–0,4 s | 170–245 ms | 114–137 MB |

"Pronto" inclui baixar os chunks do mapa, os dados e compilar os shaders na GPU por software; a **primeira** troca para Concentração/Regiões leva 1–3 s nesse ambiente (até ~5 s com 50.000 empresas) pelo mesmo motivo, e as seguintes ficam em ~0,3 s.

Técnicas:

- **GPU**: cada camada é um draw call do deck.gl; nenhum componente React por empresa. Até 20.000 pontos individuais por quadro no 2D (3.000 no 3D); clusters sem limite.
- **Viewport**: consultas ao índice só no `moveend`, com 15% de folga; lista acessível limitada a 50 itens.
- **Memoização**: índice de clusters por conjunto de dados; H3 por resolução; municípios por dados; sujeitos de filtro indexados uma vez; busca textual com `useDeferredValue`.
- **Lazy loading**: motores em chunks separados, fora do carregamento inicial da página. 2D ≈ 1,7 MB de JS (≈ 490 KB gzip: MapLibre 276 KB, deck.gl 146 KB, H3 + supercluster ≈ 67 KB); Cesium só no 3D.
- **AbortController**: dados do mapa, inicialização dos motores e "Buscar nesta área" são cancelados em troca de busca/desmonte.
- **Resposta comprimida**: `lib/map/json-response.ts` aplica gzip (o `next start`/Docker não comprime Route Handlers): 10.000 empresas = 7,4 MB → ~860 KB.
- **Limites**: `MAP_MAX_MARKERS` (padrão 10.000; 100–50.000) por busca, além do `DISCOVERY_MAX_RESULTS` da Casa dos Dados. Nunca carregamos "todas as empresas do Brasil": só o resultado da busca do usuário.

## 10. Mobile

- Desktop: painel lateral (filtros, camadas, legenda, panorama/lista) + mapa.
- Mobile (≤ 820 px): mapa em tela ampla; filtros/camadas/análise num **bottom sheet** ("Filtros e camadas" / "Filtros e análise"); empresa e região num **bottom drawer** (58% da altura), com o alvo deslocado para cima para não ficar coberto.
- Toque: pinça e duplo toque para zoom, arrastar para mover, raio de seleção de 8 px, controles de 44 px, sem rotação acidental.

## 11. Validação

Automatizada (`npm test`, sem rede):

- `tests/mapa-fase2.test.mts`: prioridade de localização (fonte → cache por empresa → CEP → município → UF), precisão nunca "exata" por engano, **filtros idênticos Lista × Mapa**, contatos fora do mapa, codec de filtros na URL, indicadores (ativas, novas em 12 meses, CNAEs, porte, percentuais sem denominador), municípios (IBGE × nome), H3 (conservação de contagem, coordenada real, limites de resolução), escala por quantis, viewport, mapas base/fallback, volume 100/1.000/10.000/50.000, gzip.
- `tests/mapa-empresarial.test.mts` (Fase 1, atualizado): localização, clusters, área, geocodificação de CEP, alternância Lista/Mapa/Inteligência com filtros.
- `tests/tabela-resultados.test.mts`: "Ver no mapa" por linha (lista → mapa) e filtros vindos da URL (mapa → lista).

Manual/navegador (`/dev/mapa`, dados sintéticos): clusters e expansão por clique, seleção pela lista e pelo mapa, painel da empresa, deep link `empresa=`, filtros refletidos na URL, Concentração (H3) e Regiões com legenda, Inteligência com ranking e indicadores, "Buscar nesta área" só após mover o mapa, 3D com colunas H3 e volta ao 2D mantendo a área, mobile (bottom sheet e drawer), 100 a 50.000 empresas.

A rota `/dev/mapa` (e `/api/dev/map-data`) só existe em desenvolvimento; em produção responde 404, salvo `MAP_DEV_HARNESS=1`.

```bash
npm install
# opcional: psql "$DATABASE_URL" -f sql/neon_map_locations.sql
npm run dev          # predev copia Cesium e o worker do MapLibre; abra /dev/mapa?n=10000
npm run lint
npm run typecheck
npm test
npm run build        # prebuild copia os mesmos assets
```

## 12. Variáveis de ambiente

| Variável | Onde | Padrão | Descrição |
|---|---|---|---|
| `NEXT_PUBLIC_MAP_BASEMAP` | navegador | `osm` | mapa base (2D e 3D). |
| `NEXT_PUBLIC_MAP_STYLE_URL` | navegador | vazio | estilo MapLibre próprio (2D). |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | navegador | vazio | opcional (3D); restrinja por URL. |
| `NEXT_PUBLIC_GOOGLE_MAP_TILES_KEY` | navegador | vazio | opcional (3D fotorrealista); restrinja por referrer. |
| `MAP_GEOCODING_PROVIDER` | servidor | `none` | geocodificação de CEP: `none` \| `brasilapi`. |
| `MAP_GEOCODING_MAX_LOOKUPS` | servidor | `25` | CEPs novos por abertura do mapa. |
| `MAP_MAX_MARKERS` | servidor | `10000` | teto de empresas enviadas ao mapa (100–50.000). |
| `MAP_AREA_SEARCH_MAX_CITIES` | servidor | `12` | municípios por "Buscar nesta área". |
| `MAP_DEV_HARNESS` | servidor | vazio | `1` habilita `/dev/mapa` fora de desenvolvimento (não recomendado em produção). |

As `NEXT_PUBLIC_*` do mapa são lidas no servidor em tempo de execução e passadas como props (não exigem rebuild), mas são **públicas**: só chaves de navegador restritas. Segredos (`CASA_DOS_DADOS_API_KEY`, `DATABASE_URL`) continuam só no servidor; o mapa não recebe payload bruto nem contatos (só "tem telefone/e-mail" para os filtros).

## 13. Limitações conhecidas

- **Precisão municipal.** A Casa dos Dados só fornece a coordenada da sede do município: sem geocodificação, empresas do mesmo município aparecem espalhadas em torno da sede (marcadas como aproximadas) e a Concentração H3 fica limitada à escala municipal.
- **Sem geocodificação de endereço.** Apenas o cache/tabela; ligar um provedor tem custo por requisição e exige revisar termos de uso.
- **"Buscar nesta área" usa a sede.** Municípios cujo território entra na tela mas a sede não, ficam de fora; consome créditos da Casa dos Dados como qualquer busca.
- **Sem limites municipais/estaduais desenhados.** Regiões são círculos na sede; polígonos IBGE (GeoJsonLayer) exigiriam hospedar a malha territorial.
- **3D**: sem camada Regiões; depende de WebGL (sem WebGL, o mapa mostra mensagem e a lista continua disponível).
- **Tiles públicos.** OSM/CARTO públicos não são para tráfego pesado — em produção com volume, use `NEXT_PUBLIC_MAP_STYLE_URL` com um provedor comercial ou próprio.
- **Chunks duplicados.** O Turbopack coloca H3 + supercluster (~67 KB gzip) nos chunks do 2D e do 3D; quem abre o 3D baixa essa parte de novo.

## 14. Custos futuros possíveis

- Tiles em volume (OSM/CARTO públicos) → provedor comercial (MapTiler, Stadia, CARTO Enterprise) ou servidor próprio.
- Cesium ion / Google Photorealistic 3D Tiles → cobrança por sessão/requisição (só se as chaves forem configuradas).
- Geocodificação de endereço (Google, HERE, Mapbox) → por requisição; grava em `establishment_locations`.
- "Buscar nesta área" → créditos da Casa dos Dados.
