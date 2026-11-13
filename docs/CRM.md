# Fase 6 — CRM nativo do BuscaCNAE

## Resultado

Um CRM leve, integrado às empresas e listas que já existem no BuscaCNAE:

`Empresa → Lead → Contato → Interessado → Reunião → Proposta → Cliente`

- **Empresa como entidade central.** Um negócio (`crm_deals`) guarda `establishment_id` e nunca copia razão social, CNPJ, cidade ou CNAE. Os dados aparecem por JOIN em `establishments`; quando a ficha é atualizada, o CRM mostra o dado novo.
- **Pipeline configurável** por workspace (padrão: Novo, Contato realizado, Interessado, Reunião, Proposta, Ganho, Perdido).
- **Histórico** somente-inserção de etapa, responsável, notas, tarefas, contatos, valor e origem do lead, sempre com autor e data.
- **Visões:** Kanban (arrastar e soltar), Tabela, Tarefas, página do negócio com timeline e painel CRM na ficha da empresa.
- **Equipes e permissões:** workspace pessoal automático, equipes com owner/admin/membro e isolamento entre organizações no banco e em toda consulta.

## Análise do Twenty

O repositório foi estudado em `packages/twenty-server/src/modules` (opportunity, task, note, timeline, workspace-member) e `packages/twenty-front/src/modules` (record-board, activities/timeline-activities).

- **Licença:** a maior parte é **AGPLv3** (com arquivos `@license Enterprise` sob licença comercial). Só alguns pacotes são MIT (twenty-ui, twenty-shared, SDKs). Seguindo a mesma política da Fase 5 para OpenGTM/OpenEnrich, **nenhum código foi copiado**. O Twenty serviu só de referência de conceitos e UX. Também não foi adicionada nenhuma dependência do Twenty.
- **O que foi aproveitado:**

| Conceito no Twenty | Como ficou no BuscaCNAE |
|---|---|
| `Opportunity` com `stage`, `position`, `amount`, `closeDate`, `owner`, `pointOfContact`, `company` | `crm_deals`: `stage_id`, `position`, `amount_cents`, `expected_close_date`, `owner_profile_id`, `primary_contact_id`, `establishment_id` |
| Stage como opções de select | Tabela `crm_pipeline_stages` por workspace, com `kind` (open/won/lost) para fechar negócios |
| `Task` + `TaskTarget` (alvo polimórfico) | `crm_tasks` ligada ao negócio (alvo único, mais simples) |
| `Note` + `NoteTarget` | `crm_notes` ligada ao negócio |
| `TimelineActivity` com diff de propriedades e agrupamento por mês | `crm_activities` (tipo + payload com de/para), timeline unificada agrupada por mês |
| Record board: posição fracionária, arrastar entre colunas | `lib/crm/board.ts`: média entre vizinhos e renumeração quando o intervalo acaba |
| `WorkspaceMember` e papéis | `crm_workspaces` + `crm_workspace_members` (owner/admin/member) |

- **O que ficou de fora (de propósito):** objetos customizáveis por metadados, GraphQL, workflows, e-mail/calendário, anexos, views salvas e filtros arbitrários. O BuscaCNAE precisa de um funil sobre empresas que já estão na base, não de uma plataforma de CRM genérica.

## Modelo de dados

Execute [`sql/neon_crm.sql`](../sql/neon_crm.sql) no Neon (depois de `neon_users_auth.sql` e `neon_prospecting.sql`). A migração é aditiva e idempotente. Ela usa `ON DELETE SET NULL (coluna)`, que exige PostgreSQL 15+ (o padrão do Neon é 16/17).

| Tabela | Papel |
|---|---|
| `crm_workspaces` | Organização. Um workspace pessoal por usuário (índice único parcial) e equipes adicionais. |
| `crm_workspace_members` | Associação com papel (`owner`, `admin`, `member`). |
| `crm_pipeline_stages` | Etapas do pipeline, com posição e tipo (`open`/`won`/`lost`). |
| `crm_deals` | Negócio: **referência** à empresa, etapa, posição no Kanban, responsável, valor, previsão, origem (`source` + `source_ref`), fechamento. `UNIQUE (workspace_id, establishment_id)`: uma empresa entra uma vez por workspace. |
| `crm_contacts` | Pessoas de contato de uma empresa, cadastradas pelo usuário (dado pessoal, ver LGPD). |
| `crm_notes`, `crm_tasks` | Notas e tarefas do negócio (tarefa com prazo, responsável e status). |
| `crm_activities` | Histórico somente-inserção. Se o negócio é removido, o evento `deal.deleted` continua ligado à empresa. |

**Isolamento no banco:** as FKs compostas `(workspace_id, stage_id)`, `(workspace_id, deal_id)` e `(workspace_id, primary_contact_id)` impedem que um negócio aponte para etapa, nota, tarefa ou contato de outro workspace, mesmo se o código errar.

## Código

| Caminho | Conteúdo |
|---|---|
| `lib/crm/types.ts` | Tipos do domínio. |
| `lib/crm/pipeline.ts` | Pipeline padrão, validação, reordenação, exclusão de etapa, efeitos de ganho/perda. |
| `lib/crm/board.ts` | Posições do Kanban, `applyMove` (usado na UI otimista e nos testes), agrupamento por etapa. |
| `lib/crm/permissions.ts` | Regras de papel, puras e testadas. |
| `lib/crm/timeline.ts` | Construtores de eventos, descrição em português e timeline agrupada por mês. |
| `lib/crm/input.ts` | Normalização de formulários (R$, datas no fuso de São Paulo, e-mail) e plano de importação lista → CRM. |
| `lib/crm/repository.ts` | Todas as consultas SQL. Cada função recebe um `CrmContext`. |
| `lib/crm/server.ts` | Resolve sessão + workspace ativo (cookie só guarda a preferência; a associação é verificada no banco a cada requisição). |
| `lib/crm/messages.ts` | Mensagens de retorno. Um `detail` vindo da URL só é exibido se for uma mensagem conhecida. |
| `app/dashboard/crm/actions.ts` | Server actions (entrada normalizada → permissão → mudança + histórico na mesma transação). |
| `app/dashboard/crm/page.tsx` | Kanban, Tabela e Tarefas (`?view=`), com filtros por busca, responsável e origem. |
| `app/dashboard/crm/[dealId]/page.tsx` | Negócio: detalhes, responsável, tarefas, contatos, nota e timeline. |
| `app/dashboard/crm/configuracoes/page.tsx` | Pipeline (renomear, tipo, reordenar, adicionar, excluir movendo negócios) e equipe. |
| `components/crm/*` | Kanban (cliente), cabeçalho, timeline, painel da ficha, estado de migração pendente. |
| `app/styles/crm.css` | Estilos, somente com tokens de `tokens.css`. |

`lib/db.ts` ganhou `sql.transaction()` (transação não interativa do Neon HTTP). Também ganhou um executor substituível **somente para testes** (`setQueryExecutorForTests`, que recusa rodar com `NODE_ENV=production`).

## Integrações

- **Lista → CRM:** em *Leads salvos*, ao abrir uma lista, o botão **Enviar lista ao CRM** cria um negócio na etapa inicial para cada empresa que ainda não está no CRM. A origem fica gravada como `list` + id + nome da lista.
- **Lead → CRM:** cada linha de *Leads salvos* mostra **Enviar ao CRM** ou **Ver no CRM**.
- **Busca → CRM:** a barra de seleção da tabela de resultados ganhou **Enviar ao CRM** (origem `search` + id da busca).
- **Empresa ↔ CRM:** a ficha da empresa mostra o painel CRM do workspace ativo (etapa, responsável, valor, tarefas, eventos recentes) ou **Adicionar ao CRM**. A página do negócio aponta de volta para a ficha.
- Falhas do CRM (por exemplo, migração ainda não aplicada) não derrubam a ficha nem a carteira: esses painéis simplesmente não aparecem, e `/dashboard/crm` mostra como aplicar a migração.

## UX

Avaliação das quatro visões pedidas:

- **Kanban** (padrão): a leitura do funil é visual e mover é uma ação só. Tem arraste com mouse (card inteiro), arraste por toque pela alça ⠿ (para não travar a rolagem da página) e rolagem automática perto das bordas. O seletor de etapa em cada card serve para teclado, leitor de tela e celular. A atualização é otimista, o servidor recalcula a posição e, em caso de erro, o quadro volta e mostra o motivo. Esc cancela o arraste.
- **Tabela:** melhor para volume e comparação. Ordena por atualização, valor, empresa ou previsão. No celular vira lista empilhada (`table-responsive`).
- **Empresa:** o CRM aparece dentro da ficha, porque a empresa é o centro.
- **Timeline:** eventos e notas em uma coluna, agrupados por mês (como no Twenty), sem duplicar a nota.

Design: tipografia, espaçamentos, pills, tiles, cards e o controle segmentado do design system BuscaCNAE. Nenhum hex fora dos tokens, com suporte a modo claro/escuro e `prefers-reduced-motion`. No celular, cada coluna ocupa cerca de 85% da tela com encaixe, e os alvos de toque têm pelo menos 44 px.

## Permissões

| Ação | Owner | Admin | Membro |
|---|:-:|:-:|:-:|
| Ver negócios, notas e tarefas do workspace | ✓ | ✓ | ✓ |
| Criar negócio / adicionar empresa | ✓ | ✓ | ✓ |
| Editar/mover negócio | todos | todos | os seus e os sem responsável |
| Trocar responsável | qualquer membro | qualquer membro | assumir um sem responsável ou devolver o seu |
| Remover negócio | ✓ | ✓ | se for dele e criado por ele |
| Registrar nota/tarefa/contato | ✓ | ✓ | ✓ |
| Concluir tarefa | ✓ | ✓ | se for responsável pela tarefa, criador ou responsável pelo negócio |
| Configurar pipeline | ✓ | ✓ | — |
| Adicionar/remover membros | ✓ | ✓ (não mexe no owner nem em outros admins) | só sair |

- O responsável de um negócio ou tarefa precisa ser membro do workspace.
- Quem sai ou é removido da equipe deixa seus negócios e tarefas **sem responsável**. Nada é apagado e o acesso acaba imediatamente.
- **Isolamento entre organizações:** o `CrmContext` só nasce depois de confirmar a associação; toda consulta filtra `workspace_id` (há um teste que verifica isso no código-fonte do repositório); um id de outro workspace responde 404; um cookie de workspace forjado é ignorado; e as FKs compostas barram mistura no banco. A mesma empresa pode estar no CRM de duas organizações, de forma independente.
- **Membros:** hoje entram pelo e-mail de uma conta BuscaCNAE já existente. Um fluxo de convite com aceite por e-mail fica como próximo passo.

## LGPD

- O cadastro empresarial continua só em `establishments`, sem cópia.
- `crm_contacts` guarda dados pessoais **inseridos pelo usuário** (nome, cargo, e-mail, telefone). A interface avisa para registrar só o necessário. Os contatos pertencem ao workspace e podem ser excluídos, e a exclusão fica registrada no histórico com o nome.
- O histórico guarda o nome do contato criado ou excluído para manter a trilha. Se um titular pedir exclusão, também é preciso anonimizar esses payloads (pendente: definir um procedimento de atendimento a titulares).
- Retenção, exportação por titular e base legal continuam como pendências de produto e jurídico, como já registrado em `docs/PROSPECCAO.md`.

## Testes

```bash
npm run lint       # 0 erros (os 39 avisos são anteriores a esta fase)
npm run typecheck
npm test           # 183 testes (31 novos no CRM)
npm run build
```

- `tests/crm.test.mts` (unitários): pipeline, drag/drop (entre colunas, reordenação, renumeração, índice fora do limite), permissões, histórico (diffs e origem), timeline, listas → CRM, parsing de entradas, mensagens e dois testes estruturais (schema sem cópia cadastral e toda consulta `crm_*` com `workspace_id`).
- `tests/crm-db.test.mts` (integração): roda `sql/neon_crm.sql` e o **repositório real** contra PostgreSQL em memória (PGlite, nova devDependency `@electric-sql/pglite`). Cobre criação idempotente do workspace, lista → CRM sem duplicar, lead → empresa (fonte única), drag/drop persistido e fechamento/reabertura, histórico completo, permissões em equipe, isolamento entre organizações (inclusive pela FK composta), configuração do pipeline e remoção preservando a empresa.
- **E2E no navegador (validação desta fase, fora do repositório):** o app completo em `next dev` com o mesmo PGlite e sessões reais, via Playwright. Foram **51 verificações aprovadas**: estado vazio; lista → CRM (sem duplicar no reenvio); arraste com mouse entre colunas e dentro da coluna, persistido após recarregar; seletor de etapa; negócio com nota, tarefa, contato, valor e etapa, todos na timeline; painel na ficha; tabela ordenada; tarefas; filtros; pipeline (nova etapa antes de Ganho/Perdido); equipe (criação, membro, workspace ativo); membro somente leitura em negócio alheio; 404 para outra organização e para cookie forjado; celular (iPhone 13) sem rolagem horizontal no quadro, negócio, tabela e configurações, colunas com encaixe, alça de 44 px, **arraste por toque com rolagem automática entre colunas** e seletor de etapa; modo escuro; e nenhum erro de JavaScript.
  - Essa validação encontrou e corrigiu um bug real no celular: textos `.sr-only` (posição absoluta) dentro do quadro rolável alargavam o documento para cerca de 1.560 px. `.crm-card` e `.crm-column` agora são `position: relative`.

### Teste manual após aplicar a migração

1. Abrir **CRM** no dashboard (o workspace pessoal e o pipeline são criados no primeiro acesso).
2. Em *Leads salvos*, abrir uma lista e usar **Enviar lista ao CRM**. Reenviar e confirmar que nada foi duplicado.
3. Arrastar cards entre etapas e dentro da coluna, recarregar e conferir que a ordem se manteve. No celular, usar a alça ⠿ e o seletor.
4. Abrir um negócio e registrar nota, tarefa, contato, valor e responsável, conferindo a timeline.
5. Abrir a ficha da empresa e conferir o painel CRM.
6. Em *Pipeline e equipe*, criar uma equipe, adicionar um colega, mudar o papel dele, entrar como ele e confirmar o que ele pode e não pode fazer.
7. Entrar com um usuário de outra organização e confirmar 404 nas URLs de negócio.

## Fase 8: prospects manuais, WhatsApp e histórico comercial

### O que mudou

- **+ Novo prospect** no cabeçalho do CRM e em *Leads salvos* abre `/dashboard/crm/novo`. O cadastro funciona sem busca e sem compra de lista. Pode ser **empresa** (CNPJ opcional) ou **pessoa física** (CPF opcional). Só o nome é obrigatório.
- O prospect entra direto no pipeline, no mesmo fluxo dos leads de busca: Kanban, movimentação, responsável, contatos, tarefas, observações, timeline, filtros e pesquisa.
- **WhatsApp:** link oficial `https://wa.me/<número>` em nova aba. No celular ele abre o app e, no desktop, o WhatsApp Web, com fallback no navegador. O link aparece na lista (tabela), nos cards do Kanban, na ficha do negócio, nos contatos, na ficha da empresa (telefone público) e em *Leads salvos*. O compositor da ficha do negócio permite escolher um modelo, editar a mensagem ou abrir sem mensagem.
- **Modelos de mensagem** por workspace, em *Pipeline e equipe → Modelos de mensagem*. Há três modelos padrão no código (primeiro contato, retomada, proposta) e modelos próprios com criar, editar e excluir.
- **Ações rápidas na ficha:** registrar contato (ligação, WhatsApp, reunião, e-mail, visita) com resultado, data e resumo; adicionar observação; agendar o próximo contato ou marcar como realizado; criar tarefa.
- **Indicadores** no Kanban e na Tabela, calculados com os filtros atuais: em aberto, valor em aberto, ganhos e taxa de ganho, cadastros manuais e contatos atrasados.

### Decisões de arquitetura

1. **Dado do usuário ≠ dado oficial.** O que o usuário digita vai para `crm_prospects`, que pertence ao workspace. Nunca vai para `establishments`, e nenhum registro empresarial falso é criado para quem não tem CNPJ.
2. **Um alvo por negócio.** `crm_deals.establishment_id` passou a aceitar nulo e ganhou `prospect_id`. O CHECK `crm_deals_one_target` (`num_nonnulls = 1`) garante que cada negócio aponte para exatamente um dos dois. `crm_contacts` segue a mesma regra.
3. **Isolamento no banco.** A FK composta `(workspace_id, prospect_id)` impede que um negócio ou contato aponte para um prospect de outro workspace, mesmo que o código erre.
4. **CNPJ já existente na base.** O formulário consulta a base e oferece *vincular à ficha oficial* (recomendado). Nesse caso o negócio referencia `establishments` e o responsável, os telefones e o e-mail informados viram um `crm_contacts` do workspace. A ficha oficial não é alterada. Nenhuma consulta externa paga é feita.
   - A empresa só é **revelada e vinculada** se o usuário já tiver acesso a ela, pelas mesmas regras de `lib/search/visibility.ts`: busca liberada (paid/free), empresa salva ou negócio em um workspace do qual participa. Sem esse acesso, a verificação de CNPJ não informa que a empresa existe e o cadastro segue como manual. Assim a checagem de duplicidade não vira um atalho para dados ainda não liberados.
   - O servidor confere se o CNPJ informado é o mesmo da empresa vinculada. Um id forjado ou desatualizado no campo oculto é recusado.
   - O usuário pode desmarcar o vínculo e manter um cadastro manual com esse CNPJ. O requisito é *oferecer* o vínculo, e o registro guarda apenas o que o usuário digitou.
5. **Duplicidades** por CNPJ/CPF, telefone (comparando o número normalizado, então "(41) 99999-8888" e "+55 41 99999 8888" colidem) e e-mail, só dentro do workspace ativo. As possíveis duplicidades são **exibidas, nunca mescladas**. Um CNPJ/CPF repetido no mesmo workspace é bloqueado por índice único.
6. **Telefones não destrutivos.** O número é guardado exatamente como digitado e a normalização (`lib/whatsapp.ts`) acontece só na leitura. O DDI 55 só é acrescentado quando o número é brasileiro válido (DDD + 8/9 dígitos). Números internacionais exigem `+` ou `00`. Números 0800, inválidos ou ambíguos não geram link.
7. **WhatsApp não comprova envio.** Abrir o link não grava nada. O histórico só recebe `interaction.logged` quando o usuário clica em *Registrar*, seja no formulário ou no compositor depois de abrir a conversa. Não há envio automático nem API paga.
8. **Origem estruturada.** `crm_prospects.origin` aceita uma lista fechada (Busca BuscaCNAE, Cadastro manual, Indicação, WhatsApp, Visita comercial, Telefone, Site, Redes sociais, Evento, Importação, Outros) mais um detalhe livre. A entrada no CRM continua em `crm_deals.source = 'manual'`. As duas aparecem no histórico (`deal.created` e `prospect.created`) e podem ser filtradas.

### Migração

Rode [`sql/neon_crm_prospects.sql`](../sql/neon_crm_prospects.sql) **depois** de `neon_crm.sql`. Ela é aditiva, idempotente e transacional (BEGIN/COMMIT):

| Objeto | Mudança |
|---|---|
| `crm_prospects` | Nova tabela (tipo, nome, fantasia, documento, origem, segmento, cidade/UF, endereço, responsável, telefones, e-mail, site, tags). |
| `crm_deals` | `establishment_id` aceita nulo; novos `prospect_id`, `priority` (`low`/`normal`/`high`) e `next_contact_at`; FK composta, CHECK de alvo único, UNIQUE `(workspace_id, prospect_id)`. |
| `crm_contacts` | `establishment_id` aceita nulo; novos `prospect_id` (cascata com o prospect) e `whatsapp`; CHECK de alvo único. |
| `crm_activities` | Nova coluna `prospect_id`; o CHECK de tipos é recriado com `prospect.created`, `prospect.updated`, `interaction.logged` e `next_contact.scheduled`. |
| `crm_message_templates` | Nova tabela de modelos por workspace. |

Os negócios existentes continuam válidos: todos têm `establishment_id` e passam no CHECK. Isso é coberto por teste, com a migração aplicada sobre dados já existentes.

**Reversão:** [`sql/neon_crm_prospects_rollback.sql`](../sql/neon_crm_prospects_rollback.sql) só roda se não houver nenhum dado da Fase 8 (prospects, contatos de prospect, eventos novos ou modelos). Se houver, ela aborta sem apagar nada.

O índice de busca (`lib/search/visibility.ts`) agora ignora negócios sem `establishment_id`. Os gatilhos de `neon_search_index.sql` já eram seguros para nulos.

### LGPD

- O CPF é opcional, validado e exibido por completo só na ficha do prospect. Os campos do formulário avisam para registrar só o necessário.
- `prospect.updated` registra **quais campos** mudaram, não os valores.
- Excluir um prospect exige confirmação. A exclusão apaga o cadastro, os contatos, as notas, as tarefas e o histórico daquele negócio, e deixa um único evento de auditoria sem dados pessoais (`deal.deleted` com `kind: "prospect"`).
- Pendências que continuam: política de retenção, exportação por titular e base legal para contatos de pessoas físicas (decisão de produto e jurídico).

### Arquivos

| Caminho | Conteúdo |
|---|---|
| `lib/whatsapp.ts` | Normalização (BR/internacional), `buildWhatsappUrl`, escolha do melhor número em campos com vários telefones. |
| `lib/crm/prospects.ts` | Origens, prioridade, validação de CPF/CNPJ, parsing do formulário, chaves de duplicidade. |
| `lib/crm/templates.ts` | Modelos padrão, variáveis `{nome_contato}`, `{nome_empresa}`, `{nome_usuario}` e `{cidade}`, renderização sem placeholders, validação. |
| `lib/crm/metrics.ts` | Indicadores do pipeline. |
| `lib/crm/repository.ts` | `createManualDeal`, `updateProspect`, `findDuplicates`, `logInteraction`, `scheduleNextContact`, CRUD de modelos; negócios e contatos com alvo empresa **ou** prospect. |
| `app/dashboard/crm/prospect-actions.ts` | Server actions da fase. |
| `app/dashboard/crm/novo`, `app/dashboard/crm/[dealId]/editar` | Cadastro e edição. |
| `components/crm/prospect-form.tsx`, `whatsapp-composer.tsx`, `whatsapp-link.tsx` | Formulário com verificação de duplicidade, compositor (`<dialog>` nativo) e link. |

### Revisão independente (Codex)

A primeira auditoria não encontrou nada crítico. Encontrou 3 problemas altos, 5 médios e 1 baixo. Correções:

- **Alto:** a checagem de CNPJ e o vínculo agora respeitam o acesso do usuário à empresa e conferem o CNPJ informado (ver item 4). `crm_activities.prospect_id` ganhou FK composta `(workspace_id, prospect_id)` com `ON DELETE CASCADE`.
- **Médio:** modelos e compositor recusam qualquer expressão entre chaves que não seja variável conhecida, incluindo maiúsculas, espaços, hífen e chave solta. O texto da mensagem não é mais copiado para o histórico. O vínculo com a ficha oficial não gera mais `prospect.created`. A troca de responsável já usava o nome anterior correto (falso positivo).
- **Pendente:**
  - `createDeals` (ficha → CRM e seleção da busca → CRM, da Fase 6) aceita qualquer empresa existente. A própria ficha `/dashboard/companies/[cnpj]` também abre para qualquer usuário logado. Restringir só a entrada no CRM seria incoerente, então isso fica como decisão de produto.
  - A pesquisa e a duplicidade por telefone normalizam dígitos com `regexp_replace` na hora da consulta, sempre dentro do workspace. Se algum workspace passar de alguns milhares de negócios, vale persistir uma coluna normalizada com índice.

### Testes da fase

- `tests/crm-prospects.test.mts` (unidade): WhatsApp (BR com e sem 55, operadora, fixo, internacional com `+`/`00`, recusa de 55 indevido, inválidos, 0800, codificação da mensagem, campos com vários telefones), modelos (substituição, ausência de placeholders, pontuação, injeção de chaves), CPF/CNPJ, formulário, duplicidade, histórico e indicadores.
- `tests/crm-prospects-db.test.mts` (PGlite + repositório real): migração sobre dados existentes e reaplicada, lead de busca preservado, cadastro sem CNPJ, com CNPJ fora da base, com CNPJ da base (vínculo), pessoa física, duplicidades, edição, movimentação, contato adicional, pesquisa por telefone/e-mail/documento, filtros, registro de contato, próximo contato, tarefa, isolamento (inclusive pela FK composta e pelo CHECK), permissões em equipe, modelos, exclusão com LGPD, reversão bloqueada com dados e reversão limpa.
- **Node 24:** neste ambiente (Node 24.11 + tsx 4.20), imports **estáticos** de `.ts` a partir de `.mts` não expõem os nomes exportados. Os testes da fase e os de `crm`, `crm-db` e `prospeccao` usam `await import()`, o mesmo padrão dos testes da Fase 7.

## Fase 9: gestão de prospects (lista, arquivamento, CRM ↔ leads salvos)

Migração: [`sql/neon_crm_gestao.sql`](../sql/neon_crm_gestao.sql) (aditiva, idempotente; aplicar **depois** de `neon_crm_prospects.sql`). Reversão segura: `sql/neon_crm_gestao_rollback.sql` (aborta se houver arquivados). Se precisar reverter também a Fase 8, reverta a Fase 9 antes.

- **Arquivar ≠ excluir.** `crm_deals.archived_at/archived_by`. Arquivar tira da lista, do Kanban e dos indicadores, sem apagar nada; restaura pelo filtro *Mais filtros → Situação → Arquivados* ou pela página do negócio. Eventos `deal.archived`/`deal.restored` no histórico.
- **Exclusão protegida.** Com histórico comercial (notas, tarefas, interações, contatos, mudança de etapa, valor ou fechamento), excluir exige confirmação explícita; a checagem roda **dentro** da transação, com `FOR UPDATE` no negócio. A lista oferece arquivar como ação principal nesses casos.
- **Enviar ao CRM = CRM + leads salvos.** `createDeals` grava, na mesma instrução, o negócio (único por workspace + empresa) e o vínculo em `saved_establishments` do usuário (`NOT EXISTS` + `ON CONFLICT DO NOTHING`), sem copiar dados e sem sobrescrever notas/etapa já preenchidas. Reenviar um negócio arquivado o restaura. Busca, mapa e listas exigem que a empresa já esteja liberada para o usuário (`visibleEstablishmentIds`). A migração garante `UNIQUE (profile_id, establishment_id)` quando faltar e não houver duplicatas.
- **Prospects manuais** continuam deduplicados por documento no workspace e identificados por `crm_prospects.id`; como `saved_establishments` só referencia empresas da base, eles não entram nos leads salvos (cadastro vinculado a CNPJ da base entra).
- **Excluir/arquivar no CRM não remove o lead salvo.**
- **Lista (`?view=tabela`):** busca por empresa, CNPJ, contato, telefone e e-mail; filtros por etapa, responsável, origem, tipo, data de entrada, situação e "sem acompanhamento"; ordenação por atualização, entrada, próxima atividade, valor, empresa e previsão; paginação de 25; seleção múltipla com mover/arquivar/restaurar/excluir; ações rápidas (abrir, editar, WhatsApp, copiar telefone/e-mail, registrar interação, agendar acompanhamento, etapa, arquivar, excluir). Filtros, busca e página são preservados após cada ação.
- **Resumo comercial** (`lib/crm/metrics.ts`, regras no cabeçalho do arquivo): ativos, novos no período (7/30/90 dias), em negociação, propostas pendentes, ganhos, perdidos, valor potencial e conversão — sempre sobre o mesmo recorte filtrado da tela.
- **Limites conhecidos:** a lista carrega até 2.000 negócios por consulta e pagina/agrega em memória; acima disso, migrar para paginação e agregação em SQL.
- **Testes:** `tests/crm-gestao.test.mts` (unidade) e `tests/crm-gestao-db.test.mts` (PGlite + repositório real).

## Próximos passos sugeridos

- Convite por e-mail com aceite (em vez de adicionar pelo e-mail de uma conta existente).
- Importação em lote de prospects manuais (CSV), reaproveitando `parseProspectInput` e `findDuplicates`.
- Várias oportunidades por empresa (hoje é uma por workspace, de propósito).
- Filtros salvos e métricas do funil (conversão por etapa, tempo médio em cada etapa), aproveitando `crm_activities`.
- Procedimento LGPD de atendimento a titulares para `crm_contacts` e payloads do histórico.
