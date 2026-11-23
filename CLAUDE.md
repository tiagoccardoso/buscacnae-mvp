# BuscaCNAE — Claude Code

Plataforma de prospecção empresarial: descoberta de empresas por CNAE e localização, ficha da empresa, mapa empresarial, inteligência de mercado, CRM comercial (pipeline, notas, timeline) e venda de listas/exportações. Site: https://www.buscacnae.com.br

As regras gerais de orquestração estão em `~/.claude/CLAUDE.md`; este arquivo traz só o que é específico do projeto.

## Stack verificada (package.json e código, 22/11/2026)

- Next.js 16.2.2 (App Router), React 19.1, TypeScript 5.8, ESLint 9.
- Banco: PostgreSQL no **Neon** (`@neondatabase/serverless`), SQL escrito à mão em `lib/db.ts`/`lib/db-client.ts`. **Não usa Supabase.**
- Autenticação **própria** (`lib/auth/server.ts`): tabela `users`, senha com `scrypt`, sessão em cookie `buscacnae_session` assinado com HMAC (`NEON_AUTH_COOKIE_SECRET`). `lib/auth/neon.ts` só reexporta para compatibilidade. `middleware.ts` protege `/dashboard/*`.
- Pagamentos: Stripe 18 (Checkout, Customer Portal, webhook idempotente em `app/api/stripe/webhook`; compra avulsa de listas, formatação por IA e assinatura Pro).
- Dados de empresas: API Casa dos Dados (fonte de descoberta) com cache próprio no Neon; busca avançada em Meilisearch (`lib/search`, sincronização em `app/api/search/sync`).
- IA: OpenAI (assistente de CNAE, perguntas, formatação), com limite de uso e timeout por env.
- Mapas: MapLibre GL 6, Cesium (assets copiados em `predev`/`prebuild`). Tabelas: TanStack Table/Virtual.
- Docker (`Dockerfile`, `docker-compose.yml`) para ambiente local; deploy na Vercel (projeto não vinculado localmente — não há `.vercel/`).

## Estrutura

- `app/` — páginas públicas (landing, preços, soluções, termos), autenticação (`sign-in`, `sign-up`, `forgot-password`), `checkout`, `orders` e `dashboard/` (`search`, `companies`, `leads`, `crm`, `history`, `mapa`).
- `app/api/` — `ai`, `auth`, `chat`, `map`, `options`, `prospecting`, `search`, `stripe`, `dev` (rotas de desenvolvimento: confirme que ficam bloqueadas em produção antes de mexer).
- `lib/` — `crm` (repositório, permissões, pipeline, timeline), `search` (Meilisearch, plano de consulta, fallback), `data-quality` (normalização e `dedupe.ts`), `export` (XLSX, PDF, ficha), `prospecting` (pesquisa, enriquecimento, score), `geo`/`map`, `ai`, `billing.ts`, `stripe.ts`, `lead-pricing.ts`, `env.ts`.
- `sql/` — scripts Neon (`neon_*.sql`). Só `neon_crm_gestao` e `neon_crm_prospects` têm `*_rollback.sql`; os scripts iniciais (`neon_crm`, `neon_users_auth`, `neon_prospecting`, `neon_search_index`, `neon_map_locations`, `neon_profile_auth_fields`) não têm.
- `data/` — catálogo CNAE e municípios geocodificados. `docs/` — documentação por fase/funcionalidade (CRM, busca avançada, mapa, prospecção, IA).
- `tests/` — testes `node:test` executados com `tsx` (`*.test.mts`).

## Regras de negócio prioritárias

- **Integridade dos leads**: CNPJ armazenado como string (preparado para o CNPJ alfanumérico); normalização e deduplicação passam por `lib/data-quality`. Não crie caminhos paralelos de dedupe.
- **CRM e histórico comercial**: notas, timeline e pipeline são registros do usuário; nunca apagar histórico sem pedido explícito. Respeite `lib/crm/permissions.ts` e o escopo por usuário/perfil em todas as consultas.
- **Pagamentos e pedidos**: webhook deve continuar idempotente e com verificação de assinatura; valor mínimo de checkout (`MINIMUM_CHECKOUT_AMOUNT_CENTS`); nunca liberar exportação sem pagamento confirmado. `BYPASS_BILLING` é só para desenvolvimento.
- **Exportações confiáveis**: XLSX/PDF devem refletir exatamente os registros comprados, sem duplicatas.
- **Performance de consulta**: use índices e o índice Meilisearch; respeite limites (`DISCOVERY_MAX_RESULTS`, `MAP_MAX_MARKERS`, `ANALYSIS_MAX_COMPANIES`) e o cache da Casa dos Dados (cada chamada externa tem custo).
- **Proteção de dados**: dados de contato de empresas e de usuários não vão para logs, URLs ou respostas de IA além do necessário.

## Interface (Impeccable)

Para qualquer mudança de UI, use a Skill `/impeccable` (instalada em `.claude/skills/impeccable`, v4.10.0) e siga `DESIGN-SYSTEM.md`. Os hooks em `.claude/settings.local.json` rodam o detector após cada edição e uma checagem completa ao final da sessão. Priorize a jornada comercial (busca → resultados → ficha → CRM → checkout → exportação), tabelas densas legíveis, mapa responsivo e estados de carregamento, erro e vazio. Ainda não há `PRODUCT.md`/`DESIGN.md` do Impeccable; rode `/impeccable init` antes do primeiro trabalho grande de design.

## Comandos

- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test` (`tsx --test tests/*.test.mts`).
- Alterações de banco: todo script **novo** em `sql/` deve vir com `*_rollback.sql`; aplicar no Neon só com aprovação (o MCP Neon está em modo escrita — use apenas leitura sem autorização).

## Critérios de aceitação

Funcionalidade implementada sem regressão; `lint`, `typecheck`, `npm test` e `build` executados quando pertinentes; nenhuma quebra de idempotência do webhook, de deduplicação ou de escopo de usuário; nenhuma credencial exposta; riscos documentados.

## Documentação (Obsidian)

Notas em `C:\Users\TIAGO\Meu Drive\Obsidian\01 - Projetos\BuscaCNAE` (`BuscaCNAE.md`, `BuscaCNAE - Arquitetura.md`). Leia antes de escrever, atualize em vez de duplicar e use `[[links internos]]`. Documentação técnica por funcionalidade continua em `docs/`.
