# Fase 7 — Busca Empresarial Avançada

Status: implementada atrás de flag (`SEARCH_COMPANY_INDEX_ENABLED=false` por padrão). Lint (0 erros; os mesmos
39 avisos pré-existentes), typecheck, testes (239 sem Meilisearch; 250 com o Meilisearch real) e build verdes em 26/09/2026.

Ordem seguida: **análise → benchmark → implementação → comparação → testes → documentação.**

---

## 0. Decisão em uma frase

A Casa dos Dados continua sendo a fonte das empresas. Esta fase adiciona:

1. um **intérprete local** de texto livre (sem infraestrutura) que transforma “transportadoras pato brnaco” em
   *CNAE 4930-2/01 e 4930-2/02 + Pato Branco/PR* e abre o formulário de busca da Casa dos Dados já preenchido;
2. um **índice próprio no Meilisearch**, opcional, para pesquisar com tolerância a erro, facetas e filtros **apenas
   as empresas que o usuário já pode ver** (listas liberadas, empresas salvas e CRM). O índice replica
   campos cadastrais públicos, expira, é sincronizado por fila transacional e nunca vira fonte de verdade;
3. **fallback** em PostgreSQL com o mesmo contrato quando o índice está desligado ou fora do ar.

O índice se justifica tecnicamente pelo benchmark (§5): recall@10 de 0,57 → **0,99** (100 mil empresas) e
p95 de 6,8 ms, contra 0,92 e p95 de 2 s da melhor alternativa sem infraestrutura nova (pg_trgm).

---

## 1. Análise

### 1.1 Repositório de referência

O enunciado pede para analisar “o repositório Meilisearch local”. **Ele não existe em `D:\BuscaCNAE`** (pastas
presentes: KAI, OpenCEP, OpenGTM, OpenRefine, deck.gl, duckdb-wasm, echarts, h3-js, kepler.gl, maplibre-gl-js,
superset, table, virtual etc.). A avaliação usou o **binário oficial v1.54.0** (licença MIT) rodando como
serviço externo e a API HTTP documentada. Nenhum código do Meilisearch foi copiado e **não há SDK**: o cliente
(`lib/search/meilisearch.ts`) usa só `node:http(s)`, como as demais integrações do projeto.

Recursos do Meilisearch efetivamente usados: tolerância a erro por tamanho de palavra, desligamento de erro em
números/atributos (CNPJ), sinônimos, stop words, regras de ranking, `localizedAttributes` (português),
facetas, filtros, `delete by filter` (expiração), `swap-indexes` (reindexação sem indisponibilidade) e tarefas
assíncronas (confirmação de escrita). **Não** usados: busca híbrida/embeddings (§4), tenant tokens (a
visibilidade é aplicada no servidor, §2.3).

### 1.2 Como a busca funcionava antes

| Ponto | Comportamento | Limitação |
|---|---|---|
| Descoberta de empresas | `POST /v5/cnpj/pesquisa` da Casa dos Dados por CNAE + UF/município | exige escolher CNAE e cidade em seletores |
| Seletor de CNAE (`/api/options/cnaes`) | tokens + aliases, todos os termos precisam aparecer | “transportadoras” e “trasnportadora” → nada |
| Seletor de cidade (`/api/options/cities`) | IBGE por UF + `includes` | “pato brnaco” → nada |
| Pesquisa dentro dos resultados | filtro da tabela: todos os termos, sem acento (em memória, por busca) | sem erro de digitação; só dentro de UMA busca |
| Pesquisa na base do usuário (tudo que ele já comprou/salvou) | **não existia** | — |

---

## 2. O índice

### 2.1 Quais dados podem ser indexados

Lista branca em `lib/search/company-documents.ts` (tudo que não está nela **não** entra):

| Entra | Nunca entra |
|---|---|
| CNPJ, raiz do CNPJ | e-mail, telefone, site (produto pago do BuscaCNAE) |
| razão social **sem CPF** (MEI costuma ter “NOME 12345678901”) | endereço, número, complemento, bairro, CEP |
| nome fantasia | capital social |
| situação cadastral, matriz/filial, porte, ano de abertura | sócios / QSA |
| CNAE principal (código, classe, divisão, descrição) e secundários (códigos) | payload bruto do provedor |
| município, código IBGE, UF | qualquer dado de prospecção, notas, CRM |

Metadados de governança em cada documento: `source: "casadosdados"`, `sourceFetchedAt` (quando o dado veio da
fonte), `indexedAt`, `expiresAt`, `profileIds`, `workspaceIds` (os três últimos nunca são devolvidos na resposta).

**Autorização.** Os campos acima são dados cadastrais que a Receita Federal publica como dados abertos, e o
BuscaCNAE já os armazena em `establishments` hoje. Mesmo assim, o índice é uma **nova forma de uso** do que veio
da Casa dos Dados. Por isso o índice de empresas nasce **desligado** (`SEARCH_COMPANY_INDEX_ENABLED=false`) e só
deve ser ligado depois de confirmar que o contrato/termos da Casa dos Dados permitem essa indexação interna.
Isto é uma recomendação técnica, não parecer jurídico. O intérprete local (CNAE/CONCLA e municípios/IBGE,
catálogos públicos já versionados no projeto) não depende dessa autorização e funciona sempre.

### 2.2 Origem e “não duplicar verdade”

```
Casa dos Dados ──► establishments (Neon) ──gatilho──► search_index_outbox ──worker──► Meilisearch
     ▲                   ▲   (verdade)                   (fila, mesma transação)        (só pesquisa)
     │                   │
     └── ficha da empresa relê o banco e revalida na Casa dos Dados ◄── clique no resultado
```

Regras que impedem o índice de virar fonte oficial:

- O índice **nunca é lido para montar ficha, exportação, lista, mapa, IA ou CRM**. Ele só devolve CNPJs e rótulos
  para a pessoa escolher; ao clicar, `/dashboard/companies/[cnpj]` lê `establishments` e revalida na Casa dos Dados.
- Nenhum código escreve no banco a partir do índice. O fluxo é unidirecional (banco → índice).
- Cada resultado mostra a origem e a data (“Casa dos Dados em 20/09/2026 · revalidado ao abrir”).
- Descobrir empresas **novas** continua exclusivamente na Casa dos Dados: o índice só contém o que o usuário já
  obteve por ela.

### 2.3 Quem vê o quê (visibilidade)

Um documento é visível para um usuário se ele:

- comprou (ou recebeu grátis) a lista em que a empresa apareceu — `search_results` + `search_access_orders.status IN ('paid','free')`;
- salvou a empresa (`saved_establishments`);
- participa de um workspace do CRM com negócio da empresa (`crm_deals`; membros são consultados a cada busca).

**Prévias não pagas não entram**: o índice não pode revelar o que a tela mostra bloqueado. O filtro de
visibilidade é montado no servidor (`buildCompanyFilter`) e **sempre** é combinado com o do usuário; valores
vindos da URL são validados e escapados (teste de injeção de filtro incluído). Documento sem ninguém com acesso
não é indexado.

### 2.4 Atualização, sincronização e consistência

- **Fila transacional** (`sql/neon_search_index.sql`): gatilhos em `establishments` (só nas colunas que afetam a
  busca), `saved_establishments`, `search_access_orders` (liberação/estorno), `search_results` (reuso com pedido já
  liberado) e `crm_deals` enfileiram o CNPJ **na mesma transação** da escrita. Se o índice estiver fora do ar, nada
  se perde.
- **Worker** (`drainSearchOutbox`): lê um lote, **relê o estado atual** do banco (não o evento), grava no índice
  (substituição do documento inteiro ou exclusão), espera a confirmação da tarefa do Meilisearch e só então tira
  os itens da fila. Entrega “pelo menos uma vez”, idempotente, sem dependência de ordem.
- **Disparo**: `GET/POST /api/search/sync` com `Authorization: Bearer <SEARCH_SYNC_SECRET ou CRON_SECRET>`.
  Recomendado a cada 5 minutos (Vercel Cron no plano Pro, ou agendador externo). O plano Hobby da Vercel só
  permite cron diário, por isso **nenhum `vercel.json` foi adicionado**; exemplo para o plano Pro:
  `{"crons":[{"path":"/api/search/sync","schedule":"*/5 * * * *"}]}`.
- **Atraso máximo esperado** = intervalo do agendador + tempo do lote (≈0,4 s por 1.000 documentos no benchmark).
- **Consistência observável**: `GET /api/search/health` (mesmo segredo) devolve backlog da fila, idade do item mais
  antigo, última sincronização/reindexação/expiração e último erro.
- **Reindexação completa** (`POST /api/search/sync?mode=reindex`): constrói `<índice>_rebuild`, troca de forma atômica
  (`swap-indexes`) e apaga o antigo; eventos anteriores ao início são descartados, posteriores permanecem na fila.
  Use na carga inicial e após mudar a lista branca ou as configurações.

### 2.5 Expiração e dados desatualizados

- `expiresAt = sourceFetchedAt + SEARCH_INDEX_TTL_DAYS` (padrão 90). `sourceFetchedAt` é a data da consulta detalhada
  à Casa dos Dados (`provider_payload.casadosdados_detalhe_em`), senão a última gravação do estabelecimento.
- Toda consulta filtra `expiresAt > agora`: **documento vencido nunca é servido**, mesmo antes da limpeza.
- A rotina de sincronização remove vencidos (`delete by filter`, ~60 ms mesmo com 500 mil documentos).
- Quando a pessoa abre a ficha, a Casa dos Dados é consultada de novo; a gravação dispara o gatilho e o documento
  volta ao índice com a nova data.
- O fallback no banco aplica a **mesma** regra de validade.

### 2.6 Exclusão

Empresa removida de `establishments`, perda de acesso (lista estornada, empresa desmarcada, negócio removido) ou
dado vencido → documento excluído. Documento de quem perdeu acesso mas ainda é visível para outros é regravado
sem aquele usuário.

---

## 3. Casos de uso

| Caso | Onde | Como |
|---|---|---|
| Razão social | índice | atributo de maior peso; sufixos (LTDA, ME, EPP, EIRELI, S/A) são stop words |
| Nome fantasia | índice | segundo atributo; só é gravado quando difere da razão social |
| CNPJ | intérprete + índice | com/sem máscara e raiz viram **filtro exato**; prefixo (5–13 dígitos) busca por prefixo; nunca por aproximação |
| CNAE | intérprete + índice | código digitado vira filtro; descrição é pesquisável; sinônimos de negócio (“dentista” → odontologia) |
| Município | índice (+ sugestão) | atributo pesquisável com erro de digitação; o intérprete sugere o filtro, não aplica sozinho (§5.4) |
| UF | intérprete + filtro | sigla no fim (“… pr”) vira filtro; faceta/parâmetro `uf` |
| Pesquisa textual / typo | índice | 1 erro a partir de 4 letras, 2 a partir de 8; transposição conta como 1 |
| Acentos | índice + intérprete | normalização em ambos os sentidos |
| Facetas | índice | `stateCode`, `city`, `primaryCnae`, `registrationStatus`, `companySize`, `headquarters` |
| Filtros | API | `uf`, `cityIbge`, `city`, `cnae`, `status`, `size`, `hq` |
| Autocomplete | componente “Busca rápida” | 250 ms de debounce; empresas da base + sugestão de busca nova |
| “transportadoras pato brnaco” | intérprete | CNAE 4930-2/01 e 4930-2/02 + Pato Branco/PR → abre o formulário da Casa dos Dados preenchido |

Também melhorados, **só quando a busca exata atual não encontra nada** (ordem e resultados atuais preservados):
`/api/options/cnaes` (“trasnportadora” → CNAEs de transporte) e `/api/options/cities` (“pato brnaco” → Pato Branco).

---

## 4. IA + busca (híbrida/semântica)

**Não habilitada.** Avaliação:

- A busca convencional já atinge recall@10 de 0,96–0,99 nas nove categorias do benchmark; as falhas restantes são
  consultas genéricas cujo conjunto relevante é muito maior que 10 (limite da métrica, não da relevância).
- O caso que embeddings resolveriam — intenção sem palavra em comum (“quem vende para hospitais”) — é coberto
  hoje pelo intérprete (sinônimos curados → CNAE oficial) e pelo “Pergunte ao BuscaCNAE” (Fase 4) sobre dados
  calculados, sem risco de a IA inventar empresa.
- Embeddings exigiriam enviar razão social/descrição a um provedor externo, custo por documento, reindexação a cada
  troca de modelo e ranking menos explicável — sem ganho medido.

**Quando reavaliar**: se o log de consultas sem resultado (a instrumentar) mostrar >10 % de buscas por intenção
sem termo em comum com o CNAE. Experimento sugerido: `embedders` do Meilisearch com modelo local
(`userProvided`/Ollama) apenas sobre `primaryCnaeLabel`, `semanticRatio` 0,2–0,4, comparado com este mesmo
benchmark antes de ir para produção.

---

## 5. Benchmark (antes × depois)

### 5.1 Método

- Script reproduzível: `npx tsx scripts/search-benchmark/run.mts --size 100000 [--pg postgres://…] [--key …]`.
- Base **sintética e determinística** no formato de `establishments` (CNPJ com DV válido, 22 % MEI com CPF no nome,
  40 % dos nomes em maiúsculas sem acento, CNAE e municípios dos catálogos oficiais, polos regionais com mais peso).
  Não há dado real de cliente no benchmark.
- 93 consultas com gabarito por intenção: razão social (10), razão social com erro (20), acentos (16), CNPJ (15),
  nome fantasia (10, metade com erro), CNAE (4), atividade + cidade (6), atividade + cidade com erro (8, inclui
  “transportadoras pato brnaco”), UF como filtro (4).
- Métricas: recall@10 (relevantes no top 10 ÷ min(10, relevantes)), acerto@1, MRR@10, latência p50/p95 de ponta
  a ponta (cliente → resposta), memória (RSS), disco, tempo de indexação, atualização, exclusão e expiração.
- Ambiente: contêiner Linux, 2 vCPU, 8 GB; Meilisearch 1.54.0 e PostgreSQL 16 locais (sem latência de rede).
  Em produção some a latência de rede até o serviço (tipicamente 1–20 ms na mesma região).
- Motores: **A** = comportamento atual (filtro da tabela); **B** = PostgreSQL `unaccent`+`pg_trgm` com o mesmo
  intérprete (alternativa sem infraestrutura nova); **C** = Meilisearch com texto cru; **D** = Meilisearch + intérprete
  (caminho de produção).

### 5.2 Qualidade e latência — 100 mil empresas

| Motor | recall@10 | acerto@1 | MRR@10 | p50 | p95 |
|---|---|---|---|---|---|
| A. atual (filtro da tabela) | 0,572 | 0,548 | 0,583 | 14,8 ms | 22,0 ms |
| B. PostgreSQL pg_trgm + intérprete | 0,915 | 0,989 | 0,989 | 86,4 ms | 2.065 ms |
| C. Meilisearch (texto cru) | 0,935 | 0,925 | 0,935 | 2,9 ms | 4,1 ms |
| **D. Meilisearch + intérprete** | **0,988** | **0,978** | **0,989** | **4,3 ms** | **6,8 ms** |

Recall@10 por categoria:

| Categoria | A | B | C | D |
|---|---|---|---|---|
| razão social | 0,77 | 0,98 | 1,00 | 1,00 |
| razão social com erro | **0,00** | 0,89 | 0,99 | 0,99 |
| acentos | 0,84 | 0,81 | 0,98 | 0,98 |
| CNPJ | 1,00 | 1,00 | 0,67 | 1,00 |
| nome fantasia | 0,32 | 0,89 | 0,99 | 0,99 |
| CNAE | 0,53 | 1,00 | 1,00 | 1,00 |
| atividade + cidade | 0,98 | 1,00 | 1,00 | 1,00 |
| atividade + cidade com erro | 0,24 | 0,84 | 0,95 | 0,95 |
| UF (filtro) | 1,00 | 1,00 | 1,00 | 1,00 |

### 5.3 Escala — 500 mil empresas

| Motor | recall@10 | acerto@1 | MRR@10 | p50 | p95 |
|---|---|---|---|---|---|
| A. atual | 0,503 | 0,484 | 0,518 | 115 ms | 169 ms |
| B. pg_trgm + intérprete | 0,913 | 0,957 | 0,965 | 344 ms | 1.590 ms |
| C. Meilisearch cru | 0,901 | 0,914 | 0,930 | 4,1 ms | 7,7 ms |
| **D. Meilisearch + intérprete** | **0,964** | **0,968** | **0,984** | **5,1 ms** | **8,8 ms** |

### 5.4 Recursos e atualização

| Medida | 100 mil | 500 mil |
|---|---|---|
| Meilisearch — indexação completa | 11,2 s | 53,5 s |
| Meilisearch — disco | 261 MB | 1.389 MB |
| Meilisearch — RSS após indexar / após consultas | 654 MB / 573 MB | 977 MB / 1.468 MB |
| Meilisearch — substituir 1.000 docs (até confirmação) | 370 ms | 369 ms |
| Meilisearch — 1 doc (visível após) | 161 ms | 363 ms |
| Meilisearch — excluir 1.000 docs | 762 ms | 2.580 ms |
| Meilisearch — expiração por filtro | 58 ms | 57 ms |
| PostgreSQL pg_trgm — carga + índices | 2,0 s + 2,5 s | 9,8 s + 11,3 s |
| PostgreSQL pg_trgm — tabela + índices | 57 MB | 261 MB |
| Intérprete local (CNAE + municípios, em memória) | p50 1,5 ms · p95 5,3 ms | p50 1,8 ms · p95 7,1 ms |

Dimensionamento: o índice só contém empresas **visíveis a alguém**, não o universo da Receita. Com até ~500 mil
documentos, planeje 2–4 GB de RAM (a indexação usa mais que o regime) e 3 GB de disco.

### 5.5 Decisões tiradas do benchmark

1. **Meilisearch justificado para a base do usuário**: +0,42 de recall sobre o atual (100 mil) e, contra pg_trgm,
   20–70× mais rápido no p50 e 180–300× no p95 — o pg_trgm tem cauda longa em termos frequentes (até 2 s).
2. **Cidade não filtra silenciosamente.** A primeira versão do intérprete aplicava a cidade reconhecida como filtro:
   recall caiu para **0,76** (acentos 0,46, erros 0,64), porque sobrenomes brasileiros são cidades (Teixeira,
   Oliveira, Conceição, Nova Era, Serra, Cardoso…). Agora só é filtro o inequívoco (CNPJ, código CNAE, sigla de UF
   no fim); a cidade vira **sugestão** e o índice acha “pato brnaco” no atributo cidade sozinho.
3. **CNPJ exige o intérprete**: o texto cru com máscara (“11.222.333/0001-81”) é quebrado em números e falha
   (0,67); como filtro exato, 1,00.
4. **Catálogos (CNAE, municípios) ficam em memória**, não no Meilisearch: 1,5 ms locais, sem sincronização e
   disponíveis quando o índice cai.
5. **Transporte HTTP**: com `fetch` (undici) a busca levava **44 ms** para 2 ms de processamento (Nagle + ACK
   atrasado com keep-alive). O cliente usa `node:http(s)` com keep-alive e `setNoDelay`: **2,9 ms**.

---

## 6. Fallback

| Situação | Busca rápida (base do usuário) | Sugestão de busca nova | Busca na Casa dos Dados, ficha, listas, mapa, IA, CRM |
|---|---|---|---|
| Meilisearch não configurado / flag desligada | PostgreSQL (`engine: "database"`, `degraded: true`, sem tolerância a erro) | funciona (intérprete local) | inalterados |
| Meilisearch lento (> `SEARCH_TIMEOUT_MS`, padrão 800 ms) ou fora do ar | PostgreSQL | funciona | inalterados |
| 3 falhas seguidas | disjuntor abre por 30 s: vai direto ao banco, sem esperar timeout | funciona | inalterados |
| Meilisearch e banco fora do ar | HTTP 503: “A busca na sua base está indisponível agora. A busca de novas empresas (Casa dos Dados) continua funcionando.” | funciona | Casa dos Dados segue o próprio tratamento de erro |
| Sincronização falha | nada muda para o usuário; fila preservada; erro em `search_index_state` e em `/api/search/health` | — | inalterados |

Nenhuma rota existente passou a depender do Meilisearch.

---

## 7. Operação

1. Aplicar `sql/neon_search_index.sql` no Neon (idempotente; cria gatilhos só para tabelas existentes).
2. Subir o Meilisearch (Meilisearch Cloud ou `docker compose --profile search up -d` com `MEILI_MASTER_KEY`).
3. Criar uma chave **só de busca** para o índice (`POST /keys` com `actions: ["search"]`, `indexes: ["buscacnae_companies"]`)
   e usar a chave mestra/admin apenas em `MEILISEARCH_ADMIN_KEY`.
4. Variáveis (ver `.env.example`): `MEILISEARCH_URL`, `MEILISEARCH_SEARCH_KEY`, `MEILISEARCH_ADMIN_KEY`,
   `SEARCH_SYNC_SECRET` (≥ 16 caracteres), `SEARCH_INDEX_TTL_DAYS`, `SEARCH_TIMEOUT_MS`,
   e — após a confirmação contratual — `SEARCH_COMPANY_INDEX_ENABLED=true`.
5. Carga inicial: `curl -X POST -H "Authorization: Bearer $SEARCH_SYNC_SECRET" https://SEU-DOMINIO/api/search/sync?mode=reindex`.
6. Agendar `GET /api/search/sync` a cada 5 minutos e monitorar `GET /api/search/health`
   (alerta sugerido: `oldestPendingSeconds > 900` ou `lastError` preenchido).

Limites de uso: 600 consultas por usuário a cada 10 min (por instância, mesmo mecanismo da Fase 4).

---

## 8. Testes

| Arquivo | O que cobre |
|---|---|
| `tests/busca-avancada.test.mts` (43) | typos, acentos, CNPJ (máscara, raiz, prefixo, alfanumérico), CNAE, cidade, UF (sigla, nome, homônimos), sinônimos, plano de consulta (sobrenome ≠ cidade), lista branca do documento, CPF de MEI, validade, filtros e escape, facetas, parser da URL, cliente (erros, timeout, disjuntor), fallback em cascata, sugestão/pré-preenchimento, seletores tolerantes, configuração e segredo da sincronização |
| `tests/busca-avancada-sync.test.mts` (13) | PostgreSQL em memória (PGlite) + Meilisearch simulado: gatilhos, prévia não paga fora, pedido liberado, salvos e CRM, atualização por coluna, índice fora do ar (fila preservada, erro registrado, retomada), dado desatualizado, expiração, perda de acesso, exclusão na origem, reindexação com troca atômica, saúde, fallback no banco (visibilidade, acentos, CNPJ, UF, facetas, validade) |
| `tests/busca-avancada-meili.test.mts` (11) | **Meilisearch real** com as configurações de produção: typo (incluindo “transportadoras pato brnaco”), acentos, CNPJ exato, CNAE, cidade, UF, filtros, facetas, isolamento entre usuários, CRM por workspace, dado vencido não servido e expurgado, substituição/exclusão, permissões fora da resposta. Roda com `MEILISEARCH_TEST_URL` (e `MEILISEARCH_TEST_KEY`); sem a variável é pulado |

```bash
npm run lint && npm run typecheck && npm test && npm run build
MEILISEARCH_TEST_URL=http://127.0.0.1:7700 MEILISEARCH_TEST_KEY=chave npm test   # inclui o Meilisearch real
```

---

## 9. Limitações e próximos passos

- **Ficha da empresa (pré-existente, fora do escopo)**: `/dashboard/companies/[cnpj]` abre qualquer CNPJ salvo em
  `establishments` para qualquer usuário logado, inclusive contatos. A busca rápida **não amplia** isso (só lista o
  que o usuário já vê), mas a ficha deveria aplicar a mesma regra de visibilidade de `lib/search/visibility.ts`.
- O fallback no banco não tolera erro de digitação (é o comportamento anterior); `pg_trgm` poderia melhorá-lo, mas
  exige a extensão no Neon e tem a cauda de latência medida em §5.
- Limite de requisições é por instância (serverless); para limite global, Redis/tabela.
- Instrumentar consultas sem resultado para decidir sobre busca semântica (§4).
- Cron de 5 min requer plano Vercel Pro ou agendador externo.

## 10. Arquivos

```
lib/search/text.ts                 normalização, CPF, CNPJ, radical, distância de edição
lib/search/query-understanding.ts  intérprete local (CNAE + municípios + UF + CNPJ)
lib/search/company-query-plan.ts   o que vira filtro e o que fica no texto
lib/search/company-documents.ts    lista branca do documento, validade, origem
lib/search/company-index.ts        configurações do índice, escrita, filtros, consulta
lib/search/meilisearch.ts          cliente HTTP, erros tipados, disjuntor
lib/search/company-search.ts       serviço com fallback e sugestão de busca nova
lib/search/company-fallback.ts     busca equivalente no PostgreSQL
lib/search/visibility.ts           quem pode ver cada empresa
lib/search/sync.ts                 fila, expiração, reindexação, saúde
lib/search/fuzzy-options.ts        seletores de CNAE/cidade tolerantes a erro
lib/search/config.ts, http.ts      variáveis, parser da URL, segredo
app/api/search/companies|sync|health
components/search/company-omnibox.tsx + app/styles/search.css
sql/neon_search_index.sql
scripts/search-benchmark/          gerador da base, consultas, execução
docs/benchmarks/busca-avancada-{100k,500k}.json
```
