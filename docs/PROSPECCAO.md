# Fase 5 — Central de Prospecção BuscaCNAE

## Resultado

O fluxo implementado é:

`Busca → selecionar empresas → criar lista → lista de prospecção → enriquecer → pesquisar → qualificar → lead`

Uma lista não copia o cadastro empresarial. Ela referencia `establishments.id` (e, na interface, o CNPJ) através de `saved_establishments`. A relação guarda somente o que é operacional para o usuário: lista, tags, notas e etapa.

## Análise dos repositórios de referência

### OpenGTM

- Licença detectada: **GNU AGPL-3.0** (`LICENSE`). O pacote também contém componentes com licença própria declarada, como o node n8n MIT; isso não relicencia o restante do repositório.
- Conceitos aproveitados: entidade canônica antes de duplicar registros, proveniência por campo, waterfall com limite de custo, pesquisa orientada por propósito, sinais como eventos futuros e tabelas operacionais.
- Código não copiado. Incorporar código AGPL ao BuscaCNAE poderia tornar a combinação uma obra derivada sob AGPL e, se oferecida como serviço de rede, acionar a obrigação de disponibilizar o código-fonte correspondente aos usuários da aplicação. A separação atual evita essa consequência; uma integração futura deve ser um serviço independente ou passar por revisão de licença/comercial.

O mapeamento de conceitos ficou assim: `enrichment` virou a tabela por campo com proveniência; `audiences` virou a lista de empresas do próprio usuário, sem sincronização com anúncios; `workflows` virou o fluxo explícito de etapas e ações autenticadas; `research` virou o brief com claims rastreáveis; `signals` ficou como extensão futura, pois não há fonte contratada de eventos; e `smart tables` virou a combinação de filtros, pesquisa, tags, score explicado e exportação. Essa redução evita importar a arquitetura inteira de um produto AGPL quando o BuscaCNAE só precisa do núcleo de prospecção.

### OpenEnrich

- Licença detectada: **AGPL-3.0-only** no `package.json`, README e `LICENSE`.
- Conceitos aproveitados: waterfall determinístico, cache por empresa/domínio, `source`/método da verificação, degradação honesta de SMTP e distinção entre endereço de função e endereço de pessoa.
- Código não copiado e o pacote não foi adicionado às dependências. Nesta fase, o “enriquecimento” seguro deriva apenas domínio e presença digital do site já retornado pela fonte oficial; não faz crawling, tentativa SMTP ou descoberta de e-mail pessoal.

### GTM Skills

- Licença detectada: **MIT**.
- Conceitos aproveitados: pesquisa de conta com propósito, resolver ambiguidade antes de afirmar, marcar fatos por fonte, separar hipótese comercial de fato e tornar o score reproduzível.
- Nenhum código ou integração do Vibe Prospecting foi incorporado. Os fluxos dependem de fornecedores externos e não são fonte oficial do BuscaCNAE.

## Modelo implementado

### Dados

- `saved_lead_lists`: nome, descrição, tags, filtros futuros e critérios de score.
- `saved_establishments`: vínculo do usuário ao `establishments.id`, tags, notas e etapa (`new`, `researching`, `qualified`, `lead`, `discarded`).
- `prospecting_enrichments`: um registro por campo enriquecido, com `value`, `source`, `collected_at`, `confidence` e `is_personal`.
- `establishments`: continua sendo a única cópia do cadastro oficial; seus campos não são sobrescritos pelo enriquecimento.

Execute [`sql/neon_prospecting.sql`](../sql/neon_prospecting.sql) no Neon antes de habilitar a operação em produção.

### Score

`lib/prospecting/score.ts` calcula um número de 0 a 100 com critérios configuráveis:

- situação ativa;
- porte;
- UF-alvo;
- CNAE-alvo;
- tempo de atividade;
- presença digital.

O retorno inclui o breakdown de pontos e a justificativa de cada critério. A IA/pesquisa pode explicar o score, mas não escolhe nem inventa o número. Alvos não configurados não pontuam por coincidência invisível.

### Enriquecimento e pesquisa

O enriquecimento inicial grava somente:

- `domain`, derivado do `establishments.website`, com origem `derived:establishments.website`;
- `digital_presence`, baseado nos canais empresariais já presentes na fonte oficial, com origem `official:establishments`.

`/api/prospecting/research` gera uma pesquisa assistida factual para empresas salvas. Cada afirmação traz `source`, `collectedAt` e `confidence`; o perfil comercial é explicitamente marcado como inferido. Dados pessoais de contato não entram no brief de pesquisa.

## Operações e permissões

Todas as consultas e mutações usam `profile_id` do usuário autenticado. A lista só pode ser editada/excluída pelo proprietário. Excluir uma lista desvincula as empresas, não apaga `establishments`; remover da lista também mantém a empresa na carteira. Remover da carteira continua sendo uma ação separada.

A seleção de empresas na busca pode criar uma lista diretamente. A exportação CSV é autenticada, limitada à carteira do usuário e carrega as colunas de origem oficial, score determinístico e metadados operacionais.

## Auditoria LGPD

Este documento registra controles técnicos; não substitui revisão jurídica ou definição do papel de controlador/operador.

- **Dados públicos empresariais:** CNPJ, razão social, CNAE, endereço empresarial, situação, porte, capital, site, telefone/e-mail retornados como dados do estabelecimento. Permanecem em `establishments` e são exibidos com origem oficial.
- **Dados pessoais:** nomes de pessoas, e-mails nominais, telefones pessoais e perfis individuais não são coletados pela Fase 5. O export pode conter os canais empresariais existentes na base oficial; a operação deve confirmar que a finalidade e a origem permitem esse uso.
- **Dados inferidos:** perfil comercial, score e explicação nunca são apresentados como fato oficial. O perfil é rotulado como hipótese; o score é rotulado como cálculo.
- **Minimização:** não há tabela de cópia por lista; enriquecimento é por campo, não por réplica da empresa; pesquisa omite contatos; `is_personal` e `dataClass` permitem bloquear dados pessoais em futuras integrações.
- **Origem e atualização:** toda informação enriquecida deve manter fonte, data e confiança. Um valor novo substitui apenas o campo enriquecido correspondente; não sobrescreve a fonte oficial.
- **Direitos e retenção:** ainda é necessário definir no produto prazo de retenção, atendimento de acesso/correção/exclusão e fluxo de oposição/descadastro. A exclusão da relação do usuário já não apaga o cadastro empresarial compartilhado.
- **Segurança:** não adicionar scraping de terceiros, SMTP probing ou provedores de contatos sem avaliação de base legal, finalidade, termos do site, SSRF/rate limit, retenção e contrato do fornecedor.

## Testes e auditoria

Foram adicionados testes unitários para normalização/proveniência e score determinístico em `tests/prospeccao.test.mts`. O checklist de validação é:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Teste manual autenticado:

1. selecionar empresas no resultado e criar uma lista;
2. editar nome, tags, notas, etapa e critérios;
3. pesquisar e filtrar por lista/etapa/tag;
4. derivar domínio/presença e confirmar origem/data/confiança;
5. abrir pesquisa assistida e conferir fatos, hipóteses e limitações;
6. exportar CSV;
7. remover da lista, excluir a lista e confirmar que `establishments` não foi apagada;
8. repetir com outro usuário e confirmar que não há acesso cruzado.

## Próxima fronteira segura

Um provedor de enriquecimento externo pode ser conectado por um adaptador próprio que aceite e devolva o contrato de proveniência. Antes disso, é necessária revisão de licença dos SDKs, termos de uso das fontes, LGPD, SSRF, limites de custo e política de retenção. O código AGPL de OpenGTM/OpenEnrich não deve ser incorporado ao produto sem essa decisão explícita.
