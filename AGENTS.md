# BuscaCNAE — Instruções Codex

Repositório: BuscaCNAE (Next.js 16, React 19, TypeScript, Neon, Stripe, Meilisearch). Stack, estrutura, regras de negócio e comandos estão em `CLAUDE.md` — leia-o antes de trabalhar; este arquivo traz as regras de atuação do Codex.

## Arquitetura e convenções (resumo)

- Páginas e Route Handlers em `app/`; lógica de domínio em `lib/` (`crm`, `search`, `data-quality`, `export`, `prospecting`, `billing.ts`, `stripe.ts`). Componentes em `components/`.
- SQL escrito à mão sobre `@neondatabase/serverless`; scripts de banco em `sql/`; todo script novo deve vir com `*_rollback.sql` (os scripts iniciais não têm).
- Autenticação própria em `lib/auth/server.ts` (scrypt + cookie HMAC). Não introduza outro provedor de autenticação.
- Reutilize `lib/data-quality` para normalização/deduplicação e `lib/crm/permissions.ts` para autorização.
- Testes `node:test` em `tests/*.test.mts`.
- UI: use a Skill Impeccable em `.agents/skills/impeccable` e siga `DESIGN-SYSTEM.md`; os hooks em `.codex/hooks.json` checam as alterações de interface.

## Política de alterações

Implemente apenas a tarefa autorizada, sem reestruturações oportunistas nem dependências novas sem justificativa. Trabalhe em branch própria. Nunca execute deploy, migração em produção, push na `main`, merge de PR, alteração de preços/produtos Stripe ou exclusão de dados sem autorização explícita. Não leia nem imprima valores de `.env*`.

Verificações: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` quando aplicável. Relate arquivos modificados, testes executados, riscos e pendências; não afirme testes que não executou.

## Modo auditor independente (revisão solicitada pelo Claude Code)

Opere em **somente leitura**: não edite, crie ou apague arquivos, não faça commit, push ou deploy e não use conectores ou MCPs que alterem estado (Vercel, GitHub, banco, Stripe), salvo autorização explícita. Ao terminar, apenas relate; quem corrige é o executor. Procure falhas ativamente no diff indicado. Avalie:

1. Bugs e regressões.
2. Segurança: autenticação/sessão, injeção SQL (consultas sem parâmetros), validação de entrada, rotas `app/api/dev` expostas, segredos.
3. Autorização e escopo por usuário/perfil no CRM, leads, pedidos e exportações.
4. Pagamentos: verificação de assinatura e idempotência do webhook Stripe, liberação de exportação só após pagamento, valores mínimos.
5. Integridade de leads: CNPJ como string, deduplicação, consistência entre busca, CRM e exportação.
6. Performance: consultas sem índice, N+1, chamadas desnecessárias à Casa dos Dados/OpenAI/Meilisearch, payloads grandes no mapa.
7. Duplicação e manutenção.
8. Cobertura de testes.
9. UX da jornada comercial (busca → lead → CRM → compra → exportação).

Formato de cada achado: **severidade** (Crítico, Alto, Médio, Baixo) · arquivo:linha · evidência · impacto · recomendação. Indique as categorias sem achados e o que não foi possível verificar.
