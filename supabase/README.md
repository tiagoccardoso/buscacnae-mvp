# Supabase

Rode a migration `migrations/20260331_init.sql` no SQL Editor do projeto ou via Supabase CLI.

## O que a migration cobre

- Trigger para criar `profiles` a partir de `auth.users`
- Tabelas de billing, histórico, cache e leads
- Tabela `establishments` orientada a estabelecimento
- Índices operacionais
- RLS para acesso do usuário aos próprios dados
