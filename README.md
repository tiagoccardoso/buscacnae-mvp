# BuscaCNAE MVP

Starter pronto para deploy de um SaaS de descoberta de empresas por **CNAE + cidade**, com:

- **Next.js 16** (App Router)
- **Neon PostgreSQL** para banco de dados
- Autenticação própria com tabela `users`, hash de senha e sessão em cookie seguro
- **Stripe Checkout + Customer Portal + Webhooks**
- **CNPJ.ws Premium** ou **Casa dos Dados** como provedor de descoberta
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
- Abstração de provedor para trocar entre CNPJ.ws e Casa dos Dados

## Requisitos

- Node.js 22+
- Projeto Neon com PostgreSQL
- Conta Stripe com preços criados
- Conta no provedor de dados:
  - `CNPJ.ws Premium`, ou
  - `Casa dos Dados`

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
DISCOVERY_PROVIDER=hybrid
CASA_DOS_DADOS_API_KEY=sua_api_key
CNPJWS_API_TOKEN=seu_token_cnpjws
```

A integração usa:
- `codigo_atividade_principal`
- `uf`
- `municipio`

Observação:
- o código foi ajustado para priorizar a Casa dos Dados no fluxo principal
- `DISCOVERY_PROVIDER` pode continuar no `.env`, mas o projeto já nasce com o motor híbrido Casa dos Dados + CNPJ.ws como padrão

## 5) Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha os campos.

## 6) Rodar localmente

```bash
npm install
npm run dev
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
