# BuscaCNAE MVP

Starter pronto para deploy de um SaaS de descoberta de empresas por **CNAE + cidade**, com:

- **Next.js 16** (App Router)
- **Neon PostgreSQL** para banco de dados
- Autenticação própria com tabela `users`, hash de senha e sessão em cookie seguro
- **Stripe Checkout + Customer Portal + Webhooks**
- **Casa dos Dados** como fonte única de descoberta de empresas
- **Cache próprio + histórico de consultas** no Neon PostgreSQL
- **Schema orientado a estabelecimento + subclasse CNAE**
- **CNPJ salvo como string**, preparado para o CNPJ alfanumérico de 2026

## O que está pronto

- Landing page
- Login por e-mail e senha usando a tabela `users`
- Dashboard autenticado
- Busca por CNAE + cidade/UF
- Histórico de buscas
- Página de detalhes da empresa
- Favoritos / leads salvos
- Integração com Stripe para assinatura
- Webhook idempotente
- SQL inicial com tabelas, índices e triggers no Neon PostgreSQL
- Integração centralizada com a Casa dos Dados (timeout, retry conservador, cache e deduplicação)

## Requisitos

- Node.js 22+
- Projeto Neon com PostgreSQL
- Conta Stripe com preços criados
- Conta na Casa dos Dados com chave de API e saldo disponível

## 1) Banco Neon PostgreSQL

O SQL do banco deve estar aplicado no Neon antes de rodar a aplicação. A aplicação usa `DATABASE_URL` e a camada `lib/db.ts` com `@neondatabase/serverless` para executar as queries.

## 2) Configure autenticação própria

Execute o script `sql/neon_users_auth.sql` no Neon para criar a tabela `users` e preparar a tabela `profiles`.

Configure:

- `DATABASE_URL`
- `NEON_AUTH_COOKIE_SECRET` com pelo menos 32 caracteres

A autenticação não usa mais Neon Auth/Better Auth. O login consulta a tabela `users`, valida `password_hash` com `scrypt` e cria uma sessão por cookie seguro. A tabela `profiles` continua sendo usada para os dados complementares do usuário.

## 3) Configure a Stripe

Para o checkout avulso, configure também:

- `MINIMUM_CHECKOUT_AMOUNT_CENTS=50`

Isso evita erro de valor mínimo em cobranças pequenas na Stripe.

Crie 2 preços recorrentes e coloque os IDs em:

- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_PRO_ANNUAL`

Depois, configure o Customer Portal no dashboard da Stripe e cadastre o webhook apontando para:

- `https://SEU-DOMINIO/api/stripe/webhook`

Eventos recomendados:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `customer.updated`

## 4) Configure o provedor de descoberta

O projeto está configurado para usar a **Casa dos Dados como motor principal de busca de CNAEs**.

Defina:

```bash
CASA_DOS_DADOS_API_KEY=sua_api_key
# opcionais
CASA_DOS_DADOS_TIMEOUT_MS=15000
DISCOVERY_PAGE_SIZE=50
DISCOVERY_MAX_RESULTS=50
DISCOVERY_CACHE_TTL_HOURS=24
```

A Casa dos Dados é a **única** fonte externa de consulta de empresas (`lib/discovery/providers/casadosdados.ts`):
- `POST /v5/cnpj/pesquisa` — pesquisa paginada (`pagina`/`limite`) com `codigo_atividade_principal`, `uf`, `municipio`, `situacao_cadastral`, `mais_filtros`, `porte_empresa`, `simples`, `capital_social` e `data_abertura`
- `GET /v4/cnpj/{cnpj}` — consulta detalhada (contatos, Simples/MEI), com cache em memória e deduplicação

Buscas idênticas são reaproveitadas via tabela `provider_cache` (TTL em `DISCOVERY_CACHE_TTL_HOURS`).
Erros transitórios têm retry conservador; HTTP 429 não é repetido agressivamente.

## 4.1) Mapa Empresarial

`/dashboard/mapa` e as abas **Lista / Mapa / Inteligência** do resultado da busca mostram os mesmos resultados e filtros da lista. Mapa 2D operacional com MapLibre GL + deck.gl (clusters, empresas, "Buscar nesta área"), inteligência territorial com H3 (concentração por células, municípios e indicadores) e globo 3D opcional com CesiumJS. Funciona sem chaves pagas (OpenStreetMap). Validação local sem login/banco: `npm run dev` e abra `/dev/mapa?n=10000`. Detalhes, variáveis `MAP_*`/`NEXT_PUBLIC_MAP_*` e migração opcional `sql/neon_map_locations.sql` em [`docs/MAPA_EMPRESARIAL.md`](docs/MAPA_EMPRESARIAL.md).

## 5) Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha os campos.

## 6) Rodar localmente

```bash
npm install
npm run dev        # copia o Cesium para public/cesium (predev)
npm run lint
npm run typecheck
npm test
npm run build
```

## Deploy na Vercel

1. Suba este projeto para um repositório Git.
2. Importe na Vercel.
3. Configure todas as variáveis do `.env.example`.
4. Garanta que o webhook da Stripe aponte para a URL de produção.
5. Execute `sql/neon_users_auth.sql` no Neon antes do primeiro cadastro.

## Fluxo de billing

- Usuário entra com e-mail e senha pela tabela `users`
- Usuário escolhe plano
- Stripe Checkout cria o pedido/compra
- Webhook sincroniza assinatura no Neon PostgreSQL
- Dashboard libera histórico/listas conforme pedidos pagos
- 
## Estrutura principal

```text
app/
  api/auth/[...path]/route.ts
  api/stripe/...
  dashboard/...
components/
lib/
  auth/server.ts
  db.ts
  db-client.ts
  discovery/
  stripe.ts
```

## Observações importantes

- O projeto já grava **CNPJ como texto** para suportar coexistência entre numérico e alfanumérico.
- A busca usa **cache próprio** no Neon PostgreSQL para reduzir custo do provedor.
- Os dados de empresa ficam no nível de **estabelecimento**, não apenas empresa raiz.
- O parser dos provedores foi feito de forma resiliente, mas você pode ajustar os mapeamentos conforme sua conta/plano retornar campos adicionais.

## Checklist antes de ir para produção

- Ajustar branding
- Criar página de termos / privacidade
- Definir limites por plano
- Adicionar logs e observabilidade
- Adicionar proteção anti-abuso / rate limiting
- Revisar preços e copy comercial

## Rodando com Docker

Este projeto inclui:

- `Dockerfile` multi-stage para build e runtime
- `docker-compose.yml` para subir a aplicação
- `.env.docker.example` para facilitar a configuração
- `DOCKER-WINDOWS-CMD.md` com comandos prontos para CMD no Windows

### Passos rápidos

```bash
cp .env.docker.example .env
# preencha o .env
docker compose build
docker compose up -d
```

A aplicação ficará disponível em `http://localhost:3000`.

Para um passo a passo completo em Windows CMD, veja `DOCKER-WINDOWS-CMD.md`.

> Observação: variáveis `NEXT_PUBLIC_*` são usadas no build do Next.js. Se você alterá-las, rode novamente `docker compose build`.
> Dica: para validar o fluxo do app localmente sem assinatura ativa, você pode usar `BYPASS_BILLING=true` no `.env`.
