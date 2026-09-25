# Inteligência de Mercado (Fase 3)

Transforma o resultado de uma busca do BuscaCNAE em indicadores mensuráveis, com gráficos Apache ECharts e drill-down para a lista e o mapa. **Não há base própria, estimativa, projeção nem IA**: cada número é uma contagem, soma, média ou mediana calculada de forma determinística sobre as empresas que a Casa dos Dados devolveu para a busca.

- Resultado de uma busca: `/dashboard/search/[id]` com `[ Empresas ] [ Mapa ] [ Inteligência ]` (`?view=mapa` / `?view=inteligencia`).
- `/dashboard/mapa?view=inteligencia` redireciona para a Inteligência da busca selecionada.
- Validação local sem login, banco ou Casa dos Dados: `/dev/mapa?n=100|1000|10000|20000|50000&view=inteligencia` (em produção só com `MAP_DEV_HARNESS=1`).

Status (25/09/2026): lint (0 erros), typecheck, **122 testes** (16 novos) e build verdes. Validado em navegador (Chromium headless, build de produção) com 1.000, 10.000 e 50.000 empresas, claro/escuro e 390 px.

---

## 1. Experiência

| Aba | O que mostra | Dados |
|---|---|---|
| **Empresas** (antiga "Lista") | tabela, seleção, carteira, CSV, compra | universo analisado |
| **Mapa** | MapLibre + deck.gl, H3, regiões, 3D opcional (Fase 2) | universo analisado |
| **Inteligência** | barra de filtros, 6 indicadores, 8 gráficos, empresas correspondentes | universo analisado |

As três abas leem **o mesmo conjunto de empresas** (§3) e **os mesmos filtros da URL** (§4). Trocar de aba nunca consulta a Casa dos Dados de novo.

Em todas as abas aparece o bloco **"Universo analisado: N empresas — Por que este número?"**, que abre a reconciliação completa (§3).

Na Inteligência:

1. **Barra de filtros global** (busca, situação, contato, UF, matriz/filial) — os mesmos controles do mapa — e os **chips** dos filtros de drill-down aplicados, removíveis um a um.
2. **Indicadores**: empresas analisadas, ativas, novas (12 meses), com telefone ou e-mail, municípios (+ UF e CNAEs distintos), capital social mediano.
3. **Gráficos** (Apache ECharts): município (top 12), UF, CNAE principal (top 10), porte, situação cadastral, faixas de capital social, evolução de abertura por ano e aberturas nos últimos 24 meses. Cada cartão tem "Ver dados em tabela" com todos os segmentos, percentuais e um botão **Filtrar** por linha.
4. **Empresas correspondentes**: quantas empresas passam pelos filtros, as 20 primeiras (ordem da busca) e os botões **Ver na lista** / **Ver no mapa**, que abrem as outras abas já filtradas.

### Drill-down

Todo indicador pode ser explorado:

```
Gráfico "Empresas por município" → clique em "Campinas/SP"
   → filtro municipio=3509502 na URL (chip "Município: Campinas/SP")
   → indicadores, demais gráficos e "Empresas correspondentes" passam a mostrar só Campinas
   → "Ver na lista"  → /dashboard/search/{id}?municipio=3509502        (tabela filtrada)
   → "Ver no mapa"   → /dashboard/search/{id}?view=mapa&municipio=3509502
   → "Mapa" ao lado de uma empresa → mapa focado nela (empresa={id})
```

| Onde se clica | Filtro aplicado (URL) |
|---|---|
| Município | `municipio=<IBGE>` (ou `na` = município não identificado) |
| UF | `uf=SP` |
| CNAE principal | `cnae=<7 dígitos>` (ou `na`) |
| Porte | `porte=<chave>` (`me`, `epp`, `demais`… ou `na`) |
| Situação cadastral | `situacao=<chave>` (`ativa`, `baixada`, `inapta`… ou `na`) |
| Faixa de capital | `capital=<faixa>` (§5.3) |
| Ano de abertura | `abertura=AAAA` |
| Mês de abertura | `abertura=AAAA-MM` |
| Indicador "Novas (12 meses)" → Filtrar | `abertura=12m` |

Clicar de novo no mesmo segmento (ou em "Limpar filtro" no cartão, ou no "×" do chip) remove o filtro. O clique funciona na barra, em qualquer ponto da faixa da categoria e no rótulo do eixo; pelo teclado, use a tabela do cartão.

**Cross-filter.** O gráfico de uma dimensão é calculado com **todos os filtros menos o dela** (padrão de cross-filter do Superset): ao escolher Campinas, o gráfico de municípios continua mostrando os demais municípios (Campinas em cor cheia, os outros esmaecidos), enquanto indicadores e demais gráficos já mostram só Campinas.

---

## 2. Arquitetura e origem dos dados

```
Casa dos Dados (POST /v5/cnpj/pesquisa + GET /v4/cnpj/{cnpj})       ← única fonte
      ↓ prepareSearchOrder (Fase 1)
search_results + establishments (Neon)
      ↓ lib/analytics/universe-server.ts  loadSearchUniverse()        ← REGRA ÚNICA (§3)
      ↓ lib/company-model.ts              Company
      ├── Empresas ─ page.tsx → CompanyListItem → CompanyResultsTable
      └── GET /api/map/searches/[id] → MapCompany (sem contatos, sem payload)
              ├── Mapa ────────── BusinessMapWorkspace (Fase 2)
              └── Inteligência ── toAnalyticsRecords → buildIntelligenceReport → ECharts
```

A Inteligência **não tem endpoint nem modelo próprios**: consome o mesmo JSON do mapa (`MapSearchData`) e o converte com o mesmo adaptador de filtros do mapa (`mapCompanyToFilterSubject`). Os cálculos rodam no navegador sobre o universo já liberado (§6).

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Universo | `lib/analytics/universe.ts`, `lib/analytics/universe-server.ts` | regra única, reconciliação, carga no servidor |
| Dimensões | `lib/analytics/dimensions.ts` | chaves de agrupamento/filtro, datas, faixas de capital, data de referência |
| Métricas | `lib/analytics/metrics.ts` | indicadores, distribuições, séries, cross-filter |
| Registros | `lib/analytics/records.ts`, `lib/analytics/labels.ts` | `MapCompany → AnalyticsRecord`, rótulos dos filtros |
| Gráficos | `lib/analytics/chart-options.ts` | opções ECharts puras (testáveis sem navegador) |
| Filtros | `lib/results/company-table-model.ts`, `lib/results/filter-params.ts` | regra única Lista/Mapa/Inteligência + URL |
| UI | `components/intelligence/*`, `components/analytics/*` | workspace, `EChart`, `ChartCard`, chips, universo |
| Estilo | `app/styles/intelligence.css` | somente tokens do design system |

---

## 3. Universo analisado (regra única)

Antes da Fase 3 a lista lia todas as linhas liberadas e o mapa no máximo `MAP_MAX_MARKERS`, cada um com seu contador. Agora a página (aba Empresas) e a API do mapa (Mapa e Inteligência) chamam a mesma função, `loadSearchUniverse` → `buildAnalysisUniverse`:

```
informadas pela Casa dos Dados          reported  = search_queries.total_results
gravadas nesta busca                    stored    = count(search_results)
− bloqueadas até a compra               locked    = stored − 1 antes do pagamento, 0 depois
− acima do teto de análise              overLimit = liberadas − ANALYSIS_MAX_COMPANIES (se > 0)
− sem cadastro/CNPJ utilizável          invalid
− repetidas na busca                    duplicates (mesmo estabelecimento, contado 1 vez)
= UNIVERSO ANALISADO                    analyzed
```

Invariante (testada): `stored = locked + overLimit + invalid + duplicates + analyzed`. A diferença `reported − stored` (resultados que a Casa dos Dados informou mas a busca não carregou por `DISCOVERY_MAX_RESULTS`) aparece como linha informativa.

Depois do universo, **só os filtros** reduzem números, e todas as abas mostram "N de UNIVERSO". O mapa ainda informa quantas empresas não têm localização: elas continuam no universo e na lista, só não viram ponto. Assim, "Mapa = 5.200 / Dashboard = 5.187 / Lista = 5.231" não acontece: os três partem do mesmo `analyzed` e cada diferença tem uma linha explicando.

- Linhas bloqueadas **nunca** são carregadas (`universeRowLimit(false) = 1`) nem enviadas ao navegador.
- Ordem = `position` da busca; o teto corta sempre as últimas posições.
- `ANALYSIS_MAX_COMPANIES` (100–50.000); vazio = herda `MAP_MAX_MARKERS` (padrão 10.000). Com o padrão de busca (`DISCOVERY_MAX_RESULTS` 1.000) o teto não é atingido.

---

## 4. Filtros compartilhados

Mesmos nomes na URL, mesma função (`subjectMatchesFilters`) e mesmo estado nas três abas:

| Parâmetro | Filtro | Valores | Controle |
|---|---|---|---|
| `q` | busca textual | nome, CNPJ, cidade, bairro, CNAE | campo de busca |
| `situacao` | situação | `active`, `inactive`, ou chave exata (`baixada`, `na`…) | seletor + gráfico |
| `contato` | contato | `any`, `phone`, `mobile`, `email` | seletor |
| `uf` | UF | `SP`… | seletor + gráfico |
| `unidade` | matriz/filial | `matriz`, `filial` | seletor |
| `municipio` | município | IBGE (7 dígitos) ou `na` | gráfico / chip |
| `cnae` | CNAE principal | 7 dígitos (aceita `4781-4/00`) ou `na` | gráfico / chip |
| `porte` | porte | chave do porte ou `na` | gráfico / chip |
| `capital` | faixa de capital | chave da faixa ou `na` | gráfico / chip |
| `abertura` | abertura | `12m`, `AAAA`, `AAAA-MM`, `na` | gráficos / indicador / chip |

Valores inválidos voltam para "todos" (testado). Nenhum filtro dispara consulta à Casa dos Dados.

A tabela da aba Empresas, o painel do mapa e a Inteligência exibem os chips de drill-down; o seletor de situação ganha a opção exata (ex.: "Baixada") quando ela vem de um gráfico.

---

## 5. Métricas e fórmulas

Notação: **U** = universo analisado; **F** = empresas de U que passam por todos os filtros; *conhecidas* = empresas com o campo informado e válido. Campo ausente/inválido nunca é descartado nem somado a outro segmento: vira **"Não informado"** e sai dos denominadores de percentuais "entre as informadas".

### 5.1 Indicadores

| Indicador | Fórmula | Observações |
|---|---|---|
| Empresas analisadas | `|F|` | "de |U| no universo" quando há filtro |
| Ativas | `#{f ∈ F : situação = ATIVA}` ; % = ativas ÷ `#{f ∈ F : situação informada}` | comparação sem acento/caixa |
| Novas (12 meses) | `#{f ∈ F : ref − 12 meses ≤ abertura ≤ ref}` ; % = novas ÷ `#{f ∈ F : abertura válida}` | ambos os limites incluídos; datas posteriores à referência **não** contam |
| Com telefone ou e-mail | `#{f ∈ F : tem telefone ∨ tem e-mail}` ; % = ÷ `|F|` | o navegador recebe só o indicador "tem/não tem", nunca o contato |
| Municípios / UF / CNAEs | nº de chaves distintas informadas em F | "não informado" não conta como distinto |
| Capital social mediano | mediana dos capitais válidos de F | capital válido = número finito ≥ 0 |
| Capital: média e soma | soma e média exatas **em centavos inteiros** | média arredondada ao centavo |

- **Percentual sem denominador** (0 conhecidas) é exibido como "—", nunca "0%".
- **Mediana**: valor central da lista ordenada; com n par, média dos dois centrais (calculada em centavos).
- **Data de referência** (`referenceDate`, AAAA-MM-DD): calculada **uma vez no servidor** no fuso `America/Sao_Paulo` e enviada na resposta; aba Empresas, painel de região do mapa e Inteligência usam a mesma. "12 meses antes" ajusta fim de mês (29/02/2028 → 28/02/2027).

### 5.2 Distribuições (gráficos)

Para cada dimensão D: `count(s) = #{f ∈ F₋D : chave_D(f) = s}`, onde `F₋D` = U filtrado por todos os filtros **exceto** o de D (cross-filter). Sem filtro em D, `F₋D = F`. Ordenação determinística: contagem ↓, rótulo (pt-BR) ↑, chave ↑; "Não informado" sempre por último. **Invariante: Σ segmentos = |F₋D|** (testada para todas as dimensões, com e sem filtros).

| Dimensão | Chave | Origem |
|---|---|---|
| Situação | situação normalizada (`ATIVA` → `ativa`) | `registration_status` |
| UF | sigla de 2 letras | endereço |
| Município | código IBGE resolvido pela base local (código ou nome + UF) | `endereco.ibge` / município do cadastro |
| CNAE principal | 7 dígitos | `primary_cnae_code` |
| Porte | rótulo normalizado (`ME`, `EPP`, `DEMAIS`…) | porte do cadastro |
| Capital | faixa fixa (§5.3) | `capital_social` |
| Ano / mês de abertura | `AAAA` / `AAAA-MM` de uma data ISO válida | `opened_at` |

Ranking de municípios mostra os 12 maiores, CNAE os 10 maiores; o excedente aparece em texto ("Outros N segmentos: X empresas") e completo na tabela — barras + Outros + Não informado = total.

### 5.3 Faixas de capital social (fixas, intervalos `(mín, máx]`)

| Chave | Faixa |
|---|---|
| `zero` | R$ 0 |
| `ate-10k` | (0; 10 mil] |
| `10k-50k` | (10 mil; 50 mil] |
| `50k-100k` | (50 mil; 100 mil] |
| `100k-500k` | (100 mil; 500 mil] |
| `500k-1m` | (500 mil; 1 mi] |
| `1m-10m` | (1 mi; 10 mi] |
| `acima-10m` | > 10 mi |
| `na` | ausente, negativo ou inválido |

Faixas fixas (e não quantis) para serem comparáveis entre buscas.

### 5.4 Séries temporais

- **Evolução por ano**: contagem por ano de abertura, anos contíguos do menor ao maior (anos sem abertura = 0), com acumulado na tabela. Lê-se como "empresas **desta busca** abertas em cada ano" — não é o total de empresas abertas no Brasil no ano (empresas baixadas antes podem não aparecer na fonte).
- **Últimos 24 meses**: 24 meses terminando no mês da data de referência, zeros preenchidos.

### 5.5 O que não calculamos

Nada fora da busca (market share, população, PIB, densidade por habitante), nenhuma projeção, e nenhuma métrica gerada por IA nesta fase. Um indicador só existe quando o campo vem da Casa dos Dados para as empresas da busca.

---

## 6. Onde calcular: servidor × navegador × DuckDB-Wasm

### 6.1 Decisão

| Situação | Onde | Por quê |
|---|---|---|
| Liberação (compra), universo, teto, contagem de linhas | **servidor** | regra de negócio e segurança: linhas bloqueadas nunca saem do servidor |
| Indicadores e gráficos da busca (≤ 50.000 empresas) | **navegador, JavaScript puro** (`lib/analytics/metrics.ts`) | os dados já estão no navegador para o mapa; recálculo instantâneo a cada clique, sem ida ao servidor |
| Buscas acima do teto / agregações sobre muitas buscas | **servidor (Postgres/Neon, SQL)** — futuro | não enviar datasets gigantes ao navegador |
| Exploração ad hoc (SQL/pivot livre) sobre centenas de milhares de linhas já baixadas | DuckDB-Wasm — **não adotado agora** | só compensa acima de ~200 mil linhas (§6.3) |

### 6.2 DuckDB-Wasm — análise do repositório local (`D:\BuscaCNAE\duckdb-wasm`)

- **Licença**: MIT (© Stichting DuckDB Foundation) — compatível.
- **Arquitetura**: DuckDB (C++, v1.5.4) compilado para WebAssembly (`lib/`), API TypeScript `@duckdb/duckdb-wasm` que roda o banco num **Web Worker** e troca dados em Apache Arrow. Três builds: `mvp`, `eh` (exceções WASM) e `coi` (threads; exige cross-origin isolation — COOP/COEP — e `SharedArrayBuffer`). Padrão é **single-thread**; multithread é experimental (README).
- **Memória**: `-s MAXIMUM_MEMORY=4GB` (`lib/CMakeLists.txt`): teto teórico de 4 GB por instância WASM de 32 bits; na prática, bem menos em celulares. Operações fora da memória (spill) têm suporte limitado no sandbox (README).
- **Extensões** (JSON, Parquet, ICU, H3…) são baixadas da rede sob demanda (`extensions.duckdb.org`) — exigiria liberar esse host na CSP e aceitar download de código em runtime.
- **Rede**: requisições HTTP só por HTTPS e com CORS; leitura remota de Parquet usa range requests.

### 6.3 Medições (Node 22, esta máquina)

| | Valor |
|---|---|
| `duckdb-eh.wasm` | 35,9 MB (≈ 8,1 MB gzip; ≈ 5,5 MB brotli) — só o módulo principal |
| Inicialização (instanciar + abrir) | ≈ 0,95 s |
| Memória residente logo após iniciar | ≈ 290 MB |

| Empresas | DuckDB: carga (CSV → tabela) | DuckDB: 4 agregações | JS: mesmas agregações | **BuscaCNAE: relatório completo** (8 dimensões + cross-filter) |
|---:|---:|---:|---:|---:|
| 10.000 | 290 ms | 46 ms | 9 ms | 32 ms |
| 50.000 | 160 ms | 40 ms | 27 ms | 122 ms (55 ms com 5 filtros) |
| 200.000 | 310 ms | 30 ms | 104 ms | — |
| 1.000.000 | 1.933 ms | 117 ms | 478 ms | — |

Leitura: até dezenas de milhares de linhas (o universo do BuscaCNAE: 1.000 por padrão, no máximo 50.000), o JavaScript puro é mais rápido **de ponta a ponta**, sem 5–8 MB de WASM, sem ~1 s de inicialização e sem ~300 MB de memória extra. O DuckDB só passa a valer acima de ~200 mil linhas carregadas **e** com consultas livres.

### 6.4 Limite seguro, memória, performance e segurança

- **Limite seguro no navegador**: `ANALYSIS_MAX_COMPANIES` ≤ 50.000 (padrão 10.000). Com 50.000 empresas: resposta ≈ 4 MB gzip (Fase 2), heap ≈ 96 MB na aba Inteligência, relatório completo 122 ms, clique de drill-down ≈ 0,5 s até o gráfico redesenhar (Chromium headless, GPU por software).
- **Performance**: chaves de dimensão pré-calculadas uma vez por carga (`computeFacetKeys`), um único passe para avaliar todos os filtros (`buildIntelligenceReport`), busca textual adiada (`useDeferredValue`), gráficos em SVG com `setOption` (sem recriar instância).
- **Segurança**: o navegador recebe o mesmo `MapCompany` do mapa — sem telefone, e-mail, endereço completo ou payload bruto; apenas empresas liberadas; rota autenticada com `Cache-Control: private, no-store`. Tooltips escapam HTML vindo dos dados (testado). Se o DuckDB-Wasm for adotado no futuro: `wasm-unsafe-eval` na CSP, extensões servidas localmente (sem download de código de terceiros em runtime), COOP/COEP só se usar threads, e continuar enviando apenas linhas liberadas.

---

## 7. Apache ECharts

- **Repositório local** `D:\BuscaCNAE\echarts`: v6.1.0, **Apache-2.0** (NOTICE da ASF; inclui trecho de d3 sob licença BSD em `licenses/LICENSE-d3`). Dependências: `zrender` (BSD-3-Clause) e `tslib` (0BSD). Instalado do npm na mesma versão (`echarts@6.1.0`, exata); nada copiado para o projeto.
- **Arquitetura**: `echarts/core` + registro explícito de gráficos/componentes/renderizadores (`echarts.use`), permitindo tree-shaking; renderização Canvas ou SVG via zrender; componente `aria` para acessibilidade. O próprio Apache Superset usa ECharts 6.1 (`superset-frontend/package.json`, `plugins/plugin-chart-echarts`).
- **Uso no BuscaCNAE**:
  - `components/intelligence/echarts-setup.ts` registra só `BarChart`, `Grid`, `Tooltip`, `Aria` e `SVGRenderer`, carregado por um único `import()` dinâmico: **um chunk de ≈ 510 KB (≈ 173 KB gzip)** baixado só ao abrir a Inteligência (quatro imports separados duplicavam o zrender em três chunks — corrigido).
  - SVG em vez de Canvas: poucas dezenas de barras por gráfico, texto nítido, sem custo de GPU.
  - Componentes reutilizáveis: `EChart` (instância, resize, tema, clique → chave), `ChartCard` (título, nota de origem, tabela acessível com "Filtrar") e os modelos puros `rankingChartModel` / `columnChartModel`.
  - Uma medida por gráfico (contagem) → um eixo e uma cor (acento do design system); filtro ativo em cor cheia, demais esmaecidos; "Não informado" em cinza; cores lidas dos tokens e reaplicadas ao trocar tema claro/escuro.

---

## 8. Apache Superset como referência

Repositório local `D:\BuscaCNAE\superset`, **Apache-2.0** (`LICENSE.txt`). Aplicação Python (Flask) + frontend React/Redux com camada semântica, SQL Lab, permissões e conexões a bancos — **não foi incorporado** (nem embed via `superset-embedded-sdk`): seria um segundo produto, com login, banco de metadados e fonte de dados próprios, para um dataset por busca. Nenhum código copiado. Conceitos aplicados:

| Superset (código analisado) | BuscaCNAE |
|---|---|
| Native filters — `src/dashboard/components/nativeFilters/FilterBar` | barra de filtros única acima dos gráficos, valendo para todos |
| Cross-filters — `FilterBar/CrossFilters`, `src/dataMask` | clique no segmento filtra o painel inteiro; o gráfico de origem ignora o próprio filtro |
| Indicador de filtros aplicados — `src/dashboard/components/FiltersBadge` | chips "Município: Campinas/SP ×" nas três abas |
| Drill to detail — `src/components/Chart/DrillDetail` | "Empresas correspondentes" + "Ver na lista / Ver no mapa" |
| Drill by — `src/components/Chart/DrillBy` | segmento → nova dimensão (ex.: município → CNAEs daquele município nos demais gráficos) |
| Big Number + gráficos ECharts (`plugins/plugin-chart-echarts`) | faixa de indicadores + gráficos ECharts |
| Estado do dashboard no permalink | filtros na URL (`replaceState`), link copiado reabre o mesmo recorte |

---

## 9. Testes e validação

`tests/inteligencia-mercado.test.mts` (16 testes, sem rede e sem banco):

- **Dataset conhecido** (6 empresas, resultado calculado à mão): ativas 3/5 = 60%; novas 2/5 = 40% (limite de 12 meses incluído, data futura excluída); contato 3/6; distintos; capital soma R$ 2.520.000,51, média R$ 630.000,13, mediana R$ 10.000,005, mín/máx; todas as distribuições e as séries anual (com zeros e acumulado) e mensal, segmento a segmento.
- **Limites**: faixas de capital nos extremos, datas (fuso de São Paulo, 29/02, fim de mês, data inválida), percentuais sem denominador → "—".
- **Invariantes** em 5.000 empresas × 5 combinações de filtros: Σ segmentos = total; total do gráfico = indicador quando a dimensão não está filtrada; ativas + outras + não informadas = total.
- **Drill-down**: para **cada** segmento de cada dimensão (e cada ano/mês), aplicar o filtro devolve exatamente a contagem do segmento; KPI "novas" = filtro `12m`.
- **Cross-filter**: filtrar um município não altera o gráfico de municípios e altera os demais.
- **Determinismo**: entrada em outra ordem → mesmos números e mesma ordem de segmentos.
- **Consistência**: Lista (`filterCompanyListItems`), Mapa (`filterMapCompanies`) e Inteligência (`buildIntelligenceReport`) devolvem **o mesmo conjunto de ids** em 9 combinações de filtros; indicadores do painel de região do mapa = indicadores da Inteligência.
- **Universo**: bloqueio, teto, inválidas, duplicadas, invariante da reconciliação.
- **URL**: ida e volta dos novos parâmetros; valores inválidos rejeitados.
- **Gráficos**: barras + "Outros" = total; chaves de drill-down; tooltip escapa HTML.
- **Performance**: 1.000 / 10.000 / 50.000 empresas → 3 / 32 / 122 ms (relatório completo).

Navegador (build de produção, `/dev/mapa`): clique em "Aracaju/SE" (29 empresas) → URL `municipio=2800308`, chip, indicadores = 29, "Ver no mapa" abre o mapa com "29 de 1.000 empresas"; o mesmo com 10.000 (234 = 234) e 50.000 (1.134 = 1.134). Sem rolagem horizontal em 390 px; tema escuro.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

---

## 10. Limitações conhecidas

- **Universo = resultado da busca**: indicadores descrevem as empresas retornadas (até `DISCOVERY_MAX_RESULTS`, padrão 1.000), não o mercado inteiro do CNAE/região. A reconciliação mostra quantas a Casa dos Dados informou e não foram carregadas.
- **Antes da compra** o universo é a amostra liberada (1 empresa); os indicadores avisam isso.
- **Evolução de abertura** reflete empresas que constam hoje no cadastro; não mede aberturas totais históricas.
- **Município** depende de o cadastro trazer código IBGE ou nome + UF reconhecível na base local; os demais ficam em "Município não identificado" (filtráveis).
- **Porte** usa o rótulo da fonte; rótulos diferentes para o mesmo porte viram segmentos diferentes.
- **Teto** de 50.000 empresas por busca no navegador; acima disso, a agregação deve ir para o servidor (§6.1).

## 11. Variáveis de ambiente

| Variável | Onde | Padrão | Descrição |
|---|---|---|---|
| `ANALYSIS_MAX_COMPANIES` | servidor | vazio (= `MAP_MAX_MARKERS`) | teto do universo analisado por busca (100–50.000), igual para Empresas, Mapa e Inteligência |
| `MAP_MAX_MARKERS` | servidor | `10000` | (Fase 2) teto do mapa; também o teto do universo quando a variável acima está vazia |
| `MAP_DEV_HARNESS` | servidor | vazio | `1` habilita `/dev/mapa` fora de desenvolvimento |
