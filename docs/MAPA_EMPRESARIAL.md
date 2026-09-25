# Mapa Empresarial

Módulo de inteligência geográfica do BuscaCNAE. Mostra no mapa os **mesmos resultados, filtros e regras de liberação** da busca existente. Não tem base empresarial própria.

- Rota principal: `/dashboard/mapa` (item **Mapa empresarial** na navegação do dashboard).
- Resultado de uma busca: `/dashboard/search/[id]` com alternância **Lista / Mapa** (`?view=mapa`).
- Nova busca com destino no mapa: `/dashboard/search?view=mapa`.

## 1. Arquitetura

```
Casa dos Dados (POST /v5/cnpj/pesquisa + GET /v4/cnpj/{cnpj})
      ↓  lib/discovery/providers/casadosdados.ts   (adapter → NormalizedEstablishment)
      ↓  lib/discovery/service.ts                  (prepareSearchOrder: cache, filtros, persistência)
establishments + search_results (Neon)
      ↓  lib/company-model.ts                      (CompanySummary: modelo único de Lista/Mapa)
      ├── Lista   app/dashboard/search/[id]/page.tsx
      ├── Ficha   app/dashboard/companies/[cnpj]/page.tsx  (lib/company-profile.ts)
      └── Mapa    lib/map/service.ts → GET /api/map/searches/[id] → componentes do mapa
```

O mapa **não chama a Casa dos Dados**: lê as linhas que a busca oficial já gravou. As únicas consultas novas acontecem quando o usuário pede explicitamente **Buscar nesta área**, que reutiliza `prepareSearchOrder` (mesma função da busca normal).

### Arquivos

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Tipos | `lib/map/types.ts` | `MapCompany`, `CompanyLocation`, precisões, respostas da API (sem dependências de Node/Cesium). |
| Geo puro | `lib/map/geo.ts` | limites do Brasil, bbox, altura da câmera ↔ zoom, escala de visão, distribuição de pontos agregados. |
| Clusters | `lib/map/clustering.ts` | índice `supercluster`, consulta por viewport. |
| Densidade | `lib/map/density.ts` | grade + desfoque gaussiano (heatmap). |
| Área | `lib/map/area-search.ts`, `lib/map/area-search-service.ts` | "Buscar nesta área". |
| Servidor | `lib/map/service.ts` | dados do mapa por busca, respeitando pedido pago/amostra. |
| Localização | `lib/geo/company-location.ts`, `lib/geo/municipalities.ts`, `lib/geo/postal-code-geocoder.ts` | estratégia de coordenadas. |
| API | `app/api/map/searches/[id]/route.ts`, `app/api/map/area-search/route.ts` | JSON autenticado, `Cache-Control: private, no-store`. |
| Engine (browser) | `lib/map/engine/*` | loader do Cesium, viewer, providers, ciclo de vida, camadas. |
| Camadas | `lib/map/engine/layers/{companies,clusters,density}-layer.ts` | cada uma dona dos próprios primitives. |
| UI | `components/map/*` | workspace, canvas, painel da empresa, alternância Lista/Mapa. |
| Estilo | `app/styles/map.css` | somente tokens do design system. |

## 2. Integração do Cesium

- **Sem bundling do Cesium.** `scripts/copy-cesium-assets.mjs` copia `node_modules/cesium/Build/Cesium` para `public/cesium` em `predev`/`prebuild` (a pasta não é versionada). O navegador carrega `/cesium/Cesium.js` sob demanda (`lib/map/engine/cesium-loader.ts`). Os tipos vêm do pacote `cesium` (`import type`).
- **SSR seguro.** O canvas é carregado com `next/dynamic({ ssr: false })` e o engine com `import()` dentro de `useEffect`. Nenhum módulo do Cesium é avaliado no servidor: sem `window is not defined`, `document is not defined` ou hydration mismatch.
- **Ciclo de vida.** O viewer é criado **uma vez** por montagem. Dados, filtros, camada, seleção e 2D/3D passam pela API do engine sem recriar o viewer. Todo recurso registra seu descarte numa pilha (`lib/map/engine/lifecycle.ts`) — viewer, `ScreenSpaceEventHandler`, listeners de câmera/tema/teclado/wheel, `ResizeObserver`, timers de debounce, `requestAnimationFrame`, camadas e tileset 3D. `AbortController` cancela inicializações e requisições pendentes no desmonte.
- **Render sob demanda.** `requestRenderMode` ligado: o globo só redesenha em movimento de câmera, carga de tiles ou mudança de dados.

### Partes inspiradas/reutilizadas do God's Eye View

Código-fonte em `../gods-eye-view` — **MIT License, © 2026 Bilawal Sidhu**. Nenhum dataset, modelo 3D ou imagem do projeto foi copiado (o próprio `LICENSE` exclui os dados do MIT).

| God's Eye View | BuscaCNAE | Tipo |
|---|---|---|
| `src/app/viewer.js` → `installTrackpadPinchZoom` | `lib/map/engine/viewer.ts` | portado para TypeScript (pinça de trackpad como zoom) |
| `src/app/viewer.js` → `createApplicationViewer` | `createBusinessViewer` | adaptado (widgets desligados, sem camada padrão, globo visível, limites de zoom) |
| `src/app/application.js` (padrão `defer(cleanup)` + AbortSignal) | `lib/map/engine/lifecycle.ts` | adaptado |
| `src/renderGovernor.js` (idle render) | `requestRenderMode` + `requestRender()` nas camadas | ideia adaptada, sem ref-count |
| `src/maps/imagery.js`, `src/maps/google3d.js`, `src/mapStartup.js` | `lib/map/engine/providers.ts` | adaptado (credenciais explícitas, caminho sem chave) |
| contrato de camadas `init/enable/disable/update/destroy` (`src/layers/*`) | `lib/map/engine/layers/types.ts` | simplificado |

Não reutilizado: aplicação Vite, painel/UI, voz, dados ao vivo, datasets locais, tiles pagos por padrão.

## 3. Providers de mapa

| `NEXT_PUBLIC_MAP_BASEMAP` | Fonte | Custo/observação |
|---|---|---|
| `osm` (padrão) | tile.openstreetmap.org | sem chave; sujeito à política de uso do OSM (uso leve, atribuição obrigatória). |
| `carto-light` / `carto-dark` | CARTO basemaps | sem chave; limites/termos da CARTO para uso comercial. |
| `ion` | Cesium ion (Bing Aerial) | exige `NEXT_PUBLIC_CESIUM_ION_TOKEN`; cobrança conforme plano ion. |
| `offline` | Natural Earth II (incluso no Cesium) | sem rede externa, baixa resolução. |

A textura **Natural Earth II** fica sempre por baixo: se o mapa de ruas falhar, o globo continua visível. **Relevo/edifícios 3D (Google Photorealistic 3D Tiles)** aparece como botão apenas quando há `NEXT_PUBLIC_GOOGLE_MAP_TILES_KEY` ou token ion — nunca é obrigatório.

Para produção com tráfego relevante, recomenda-se um provedor comercial de tiles (ex.: CARTO Enterprise, MapTiler, Cesium ion) — basta adicionar uma fábrica em `STREET_PROVIDERS`.

## 4. Origem dos dados e localização

A Casa dos Dados retorna, em `endereco.ibge`, a **latitude/longitude do município** (IBGE) — não a coordenada do estabelecimento. A pesquisa não aceita latitude/longitude, raio ou bounding box (aceita `uf`, `municipio`, `bairro`, `cep`).

Estratégia (`lib/geo/company-location.ts`), em ordem:

1. coordenada do próprio endereço, se a fonte fornecer → `address`;
2. cache interno de CEP (`postal_code_locations`) → `postal_code`;
3. `endereco.ibge.latitude/longitude` da Casa dos Dados → `city`;
4. sede do município pela base local (código IBGE ou nome + UF) → `city`;
5. centro da UF → `approximate`;
6. sem dados → a empresa não entra no mapa (continua na lista; o painel informa a quantidade).

Modelo:

```ts
CompanyLocation { cnpj, latitude, longitude, precision, source, displayLatitude, displayLongitude }
precision: "exact" | "address" | "postal_code" | "city" | "approximate"
```

**Nunca apresentamos coordenada aproximada como exata**: marcador vazado/tracejado, legenda, aviso no painel ("Localização aproximada … o ponto não indica o endereço exato") e rótulo textual na lista acessível. Empresas que caem no mesmo ponto agregado são distribuídas em espiral determinística (raio ≤ 250 m para CEP, 2,5 km para município, 25 km para UF) apenas para desenho; `latitude/longitude` originais são preservadas.

**Base de municípios:** `data/municipios-geo.json` (5.570 municípios + 27 UFs), gerado a partir de [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) (MIT; coordenadas públicas do IBGE). Usada só no servidor — não vai para o navegador.

### Geocodificação controlada de CEP

Desligada por padrão (`MAP_GEOCODING_PROVIDER=none`). Com `brasilapi`, usa `https://brasilapi.com.br/api/cep/v2/{cep}` (gratuito):

- geocodifica **CEPs**, não empresas; no máximo `MAP_GEOCODING_MAX_LOOKUPS` (padrão 25) CEPs novos por abertura do mapa, concorrência 3, timeout 3,5 s, orçamento total 6 s;
- interrompe o lote em 429/5xx (circuit breaker);
- grava encontrados e não encontrados em `postal_code_locations` (não encontrados são retentados após 30 dias) e em memória. Sem a tabela, funciona só com memória.

Migração: `sql/neon_map_locations.sql`.

## 5. Clustering

`supercluster` (KD-tree) indexa as posições de desenho quando os **dados** mudam; a cada fim de movimento da câmera (debounce de 90 ms) só consultamos o índice com o retângulo visível e o zoom equivalente à altura da câmera. Resultado: bolhas com contagem (`1.284`, `12,4 mil`) em visão nacional, grupos menores ao aproximar e empresas individuais (com nome em zoom próximo). Clique no grupo aproxima até ele se separar; grupos que nunca se separam (mesmo ponto) abrem a lista "N empresas neste ponto".

Renderização: um `BillboardCollection` para clusters e um para empresas (+ `LabelCollection` com no máximo 120 rótulos). Ícones desenhados uma vez em canvas e compartilhados. Nenhum componente React por empresa. Pontos atrás do horizonte (3D) não são desenhados.

## 6. Densidade

Camada **Densidade**: grade 320 px sobre o retângulo dos dados, desfoque gaussiano separável, escala √ e cores do design system (`--accent` → `--warning`), drapeada como uma única imagem (`SingleTileImageryProvider`). Recalculada só quando os dados mudam.

## 7. Buscar nesta área

Ação explícita (botão aparece após o usuário mexer no mapa + confirmação). Nunca disparada por movimento de câmera.

1. o navegador envia o retângulo visível (`POST /api/map/area-search`);
2. o servidor seleciona municípios cuja sede IBGE está no retângulo;
3. área > 250.000 km² ou mais de `MAP_AREA_SEARCH_MAX_CITIES` (padrão 12) municípios → mensagem "Aproxime o mapa…";
4. executa `prepareSearchOrder` com os mesmos CNAEs e filtros da busca de origem, trocando só a localidade;
5. abre a nova busca no mapa (fica no histórico e segue a mesma regra de compra).

Não há filtro geográfico extra no resultado porque a fonte só tem precisão municipal; com precisão de endereço, filtrar pelo retângulo seria o próximo passo.

## 8. Limites

- `DISCOVERY_MAX_RESULTS` continua limitando cada combinação CNAE × localidade na Casa dos Dados.
- `MAP_MAX_MARKERS` (padrão 5.000) limita marcadores enviados ao navegador; acima disso o mapa mostra os primeiros e o aviso "Muitos resultados encontrados. Aproxime o mapa ou refine os filtros para visualizar as empresas." (não é erro).
- Até 3.000 pontos individuais desenhados por quadro; clusters não têm esse limite.
- Antes da compra da lista o mapa mostra só a amostra (1 empresa), igual à lista.

## 9. Variáveis de ambiente

| Variável | Onde | Padrão | Descrição |
|---|---|---|---|
| `NEXT_PUBLIC_MAP_BASEMAP` | navegador | `osm` | mapa base. |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | navegador | vazio | opcional; restrinja por URL no painel do ion. |
| `NEXT_PUBLIC_GOOGLE_MAP_TILES_KEY` | navegador | vazio | opcional; restrinja por referrer e à Map Tiles API. |
| `MAP_GEOCODING_PROVIDER` | servidor | `none` | `none` \| `brasilapi`. |
| `MAP_GEOCODING_MAX_LOOKUPS` | servidor | `25` | CEPs novos por requisição (0–200). |
| `MAP_MAX_MARKERS` | servidor | `5000` | teto de marcadores (100–20.000). |
| `MAP_AREA_SEARCH_MAX_CITIES` | servidor | `12` | municípios por "Buscar nesta área" (1–40). |

As variáveis `NEXT_PUBLIC_*` do mapa são lidas **no servidor em tempo de execução** e passadas como props (não exigem rebuild), mas **são públicas por definição**: só coloque chaves de navegador restritas. `CASA_DOS_DADOS_API_KEY`, `DATABASE_URL` e demais segredos continuam só no servidor (o build foi verificado: nenhum segredo, dataset de municípios ou código do Cesium no bundle cliente).

## 10. Executar localmente

```bash
npm install
# opcional: psql "$DATABASE_URL" -f sql/neon_map_locations.sql
npm run dev          # predev copia o Cesium para public/cesium
npm run lint
npm run typecheck
npm test
npm run build        # prebuild copia o Cesium
```

## 11. Custos futuros possíveis

- Tiles de mapa em volume (OSM público não é para tráfego pesado) → provedor comercial.
- Cesium ion / Google Photorealistic 3D Tiles → cobrança por sessão/requisição.
- Geocodificação com precisão de endereço (Google, HERE, Mapbox) → cobrança por requisição; a abstração `PostalCodeGeocoder` permite adicionar sem mudar o mapa.
- "Buscar nesta área" consome créditos da Casa dos Dados como qualquer busca.

## 12. Limitações conhecidas

- A Casa dos Dados só fornece coordenada municipal: sem geocodificação, empresas do mesmo município aparecem distribuídas em torno da sede (marcadas como aproximadas).
- "Buscar nesta área" usa a sede do município; municípios cujo território entra na tela mas a sede não, ficam de fora.
- Camada de limites (estados/municípios) não implementada (ver seção de pendências no relatório de entrega).
- 3D realista depende de credenciais e de GPU; em aparelhos sem WebGL o mapa mostra mensagem e a lista continua disponível.
