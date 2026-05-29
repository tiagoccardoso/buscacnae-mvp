# Rodando o BuscaCNAE no Docker pelo CMD do Windows

## Pré-requisitos

- Docker Desktop instalado e em execução
- Projeto extraído em uma pasta local
- Credenciais configuradas no Neon PostgreSQL, autenticação própria, Stripe e provedor de descoberta

## 0) Antes de subir o container, prepare o Neon

Aplique no Neon PostgreSQL o SQL do banco informado para o projeto e execute também `sql/neon_users_auth.sql` para criar a tabela users.

Se você ainda não quiser testar cobrança no ambiente local, pode deixar `BYPASS_BILLING=true` no arquivo `.env`.

## 1) Abra o CMD e entre na pasta do projeto

```cmd
cd C:\caminho\para\buscacnae-mvp
```

## 2) Crie o arquivo .env usado pelo Docker

```cmd
copy .env.docker.example .env
```

## 3) Edite o .env

Abra o arquivo `.env` e preencha os valores obrigatórios:

- `DATABASE_URL`
- `NEON_AUTH_COOKIE_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_PRO_ANNUAL`
- `DISCOVERY_PROVIDER` (use `hybrid`)
- `CASA_DOS_DADOS_API_KEY`
- `CNPJWS_API_TOKEN`

## 4) Gere a imagem

```cmd
docker compose build
```

## 5) Suba o container

```cmd
docker compose up -d
```

## 6) Veja os logs

```cmd
docker compose logs -f
```

## 7) Abra no navegador

```text
http://localhost:3000
```

## 8) Parar o projeto

```cmd
docker compose down
```

## 9) Rebuild após mudar código ou variáveis públicas

As variáveis `NEXT_PUBLIC_*` entram no build do Next.js. Se você mudar essas variáveis, refaça o build:

```cmd
docker compose down
docker compose build --no-cache
docker compose up -d
```

## 10) Rebuild simples após mudar código

```cmd
docker compose up --build -d
```

## 11) Conferir a configuração final do Compose

```cmd
docker compose config
```

## 12) Testar novamente depois de parar tudo

```cmd
docker compose up -d
```
