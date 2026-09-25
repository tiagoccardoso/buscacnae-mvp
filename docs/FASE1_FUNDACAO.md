# Fase 1 — Fundação de dados do BuscaCNAE

Status: concluída (lint, typecheck, testes e build verdes em 25/09/2026).

## 1. Referências locais (pasta `D:\BuscaCNAE`)

| Pasta | Projeto | Licença | Uso no BuscaCNAE |
|---|---|---|---|
| `table/` | TanStack Table v9.2.4 (monorepo pnpm/nx) | MIT | **Dependência** `@tanstack/react-table@^9.2.4` (npm). Pasta usada só como referência de API (`tableFeatures`, `createColumnHelper`, row selection/sorting/pagination). |
| `virtual/` | TanStack Virtual v3.14.13 | MIT | **Dependência** `@tanstack/react-virtual@^3.14.13` (npm). Referência de `useVirtualizer`. |
| `OpenRefine/` | OpenRefine (Java/Maven) | BSD-3-Clause | **Somente referência conceitual.** Nada foi copiado nem instalado (stack Java incompatível). Conceitos reimplementados em `lib/data-quality`: transforms comuns, *blank-out* de sentinelas, keyers de clustering (fingerprint e n-gram). |
| `OpenCEP/` | OpenCEP (site Jekyll + JSON de CEP) | MIT | **Somente referência de formato.** Adapter opcional em `lib/geo/postal-code-directory.ts`, desligado por padrão (`LOCATION_POSTAL_DIRECTORY=none`). Não é fonte empresarial e não devolve coordenadas. |

Os repositórios não fazem parte do build do BuscaCNAE (não há workspace/monorepo, nem imports relativos a `../table` etc.).

## 2. Fluxo de dados

```
Casa dos Dados  POST /v5/cnpj/pesquisa (paginada) + GET /v4/cnpj/{cnpj} (detalhe)
      │  lib/discovery/providers/casadosdados.ts  (retry, timeout, cancelamento, cache, dedupe)
      ▼
normalizeCasaDosDadosEstablishment  →  cleanNormalizedEstablishment  (lib/data-quality)
      │                                   NormalizedEstablishment higienizado
      ▼
lib/discovery/service.ts → persistence.ts (establishments / search_results)
      ▼
companyFromEstablishment / companyFromSearchRow   (lib/company-model.ts)
      ▼
   Company ──► CompanyListItem (tabela) · ficha · CompanySummary (mapa) · exportações · IA
```

## 3. Modelo `Company` (lib/company-model.ts)

Campos: `id`, `source`, `provenance { source, detailFetchedAt }`, `quality { issues[], completeness }`,
`cnpj`, `cnpjRoot`, `legalName`, `tradeName`, `displayName`, `status`, `openedAt`,
`legalNature { code, description }`, `headquartersOrBranch` (matriz/filial), `size`, `shareCapital`,
`simplesOptIn`, `meiOptIn`, `primaryCnae`, `secondaryCnaes[]`,
`address { street, number, complement, neighborhood, city, cityIbge, state, postalCode, country, summary }`,
`contacts { email, phone, phoneIsMobile, website }`, `location` (coordenada da própria fonte: endereço ou município),
`payload` (higienizado, nunca enviado ao cliente).

Projeções: `CompanyListItem` (serializável, sem payload — tabela client) e `CompanySummary` (mapa, formato preservado).
Regra: nada é inventado; campo ausente na fonte = `null`.

## 4. Qualidade de dados (lib/data-quality)

- `normalize.ts`: `cleanString` (NFC, controles, zero-width, NBSP, espaços, sentinelas “-”, “N/A”, “NÃO INFORMADO”, “****”),
  `normalizeCnpjValue`/`isValidCnpj` (inclui CNPJ alfanumérico), `normalizePhone` (+55, zero de DDD, operadora, DDD válido,
  9º dígito, 0800; formato `(11) 98765-4321`), `normalizeEmail`, `normalizeWebsite`, `normalizeCep`/`formatCep`
  (zero à esquerda recuperado), `normalizeUf` (sigla ou nome), `normalizeMunicipalityName` (title case pt-BR),
  `normalizeIbgeCode`, `normalizeAddressNumber` (S/N), `normalizeAddressText`, `normalizeCompanyName`,
  `normalizeCnae`/`formatCnae` (zero à esquerda recuperado), `normalizeIsoDate`.
- `dedupe.ts`: `fingerprint`, `ngramFingerprint`, `companyNameKey` (ignora LTDA/ME/EPP/S.A.), `findDuplicateClusters`,
  `dedupeByKey`, `countFilledFields`.
- `establishment.ts`: `cleanNormalizedEstablishment` (idempotente; aplicado no adapter e antes de persistir),
  `assessEstablishmentQuality` (diagnóstico não destrutivo), `mergeDuplicateEstablishments`.

CNPJ com dígito verificador inválido **não** é descartado (a fonte é oficial): é sinalizado em `quality.issues`.

## 5. Casa dos Dados

- Erros tipados (`config`, `auth`, `rate_limit`, `unavailable`, `timeout`, `network`, `invalid_request`,
  `invalid_response`, `aborted`) com mensagens amigáveis em `formatServiceError`.
- Retry conservador (503/502/504/rede com backoff+jitter; 429 só com Retry-After curto; timeout 1×).
- **Cancelamento (novo):** `searchWithCasaDosDados(input, { signal })` interrompe requisição em andamento, backoff,
  paginação e novas consultas detalhadas. Propagado de `POST /api/map/area-search` (`request.signal`) →
  `runAreaSearch` → `prepareSearchOrder` → cache/dedupe. Se uma busca compartilhada é cancelada por um chamador,
  os demais refazem a busca normalmente.
- Paginação oficial `pagina/limite` com teto de segurança, fim por total conhecido/página curta/página repetida.
- Cache: `provider_cache` (persistente) + dedupe de buscas simultâneas; detalhe em memória (30 min, LRU simples)
  + dedupe de concorrentes + reuso de detalhe salvo no banco (`DISCOVERY_DETAIL_REUSE_HOURS`).
- Circuit breaker no detalhe (auth/config/429 interrompem as demais consultas sem derrubar a busca).
- Correção: consulta detalhada sem razão social não sobrescreve mais a razão social da pesquisa com
  “Sem razão social”.

## 6. CNPJ.ws

Removida a dependência funcional: nenhuma URL, cliente, variável de ambiente, fallback ou mensagem.
Registros antigos têm o bloco legado higienizado (`lib/provider-payload.ts`) e são revalidados apenas na Casa dos Dados
ao abrir a ficha (`lib/company-profile.ts`). Testes garantem ausência de `cnpj.ws` no código de produção.

## 7. Resultados (TanStack)

`components/results/company-results-table.tsx` + regras puras em `lib/results/company-table-model.ts`:
busca sem acento/caixa (inclusive CNPJ mascarado), filtros (situação, contato, UF, matriz/filial), ordenação com
ausentes no fim, seleção e seleção múltipla com ações (salvar na carteira, CSV), paginação (25/50/100/todas),
virtualização acima de 100 linhas renderizadas, `aria-sort`, `caption`, checkboxes rotulados, estados de loading/vazio.

## 8. Testes

`npm test` (node:test + tsx): 89 testes em `tests/*.test.mts` — Casa dos Dados (paginação, erros, retry, 429,
timeout, cancelamento, cache/dedupe, reuso), normalização central, Company, tabela (filtros, ordenação, 20 mil linhas,
paginação/HTML inicial, acessibilidade), ficha (legado, falhas), mapa, OpenCEP, exportações e ausência de CNPJ.ws.

## 9. Pendências / próximas fases

- Exibir `quality.issues` (ex.: “CNPJ com dígito inválido”, “sem contato”) na ficha e como filtro da tabela.
- Usar `findDuplicateClusters(companyNameKey)` para sinalizar possíveis filiais/duplicatas por nome na lista.
- Migração opcional para re-higienizar registros antigos já salvos em `establishments` (hoje são limpos na leitura).
- 39 warnings de lint pré-existentes (`no-explicit-any`, variáveis não usadas) — nenhum erro.
- OpenCEP permanece desligado; avaliar self-host dos JSON se a Fase 2 precisar de complemento de endereço.
