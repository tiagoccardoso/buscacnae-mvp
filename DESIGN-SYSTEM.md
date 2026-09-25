# BuscaCNAE — Design System

Referência visual: skill **Apple Design** (`../apple-design`), adaptada à identidade do BuscaCNAE.
Princípios: conteúdo acima do cromo, hierarquia por tipografia e espaço (não por caixas),
materiais translúcidos só em cromo flutuante, movimento curto e com propósito.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `app/styles/tokens.css` | **Fonte única** de cor, tipografia, espaçamento, raios, sombras, materiais, movimento, z-index. Modo claro + escuro automático (`prefers-color-scheme`) e forçável (`data-theme`). |
| `app/styles/base.css` | Reset, estilos tipográficos nomeados, layout (container, section, stack, cluster, grids), animação de entrada, `prefers-reduced-motion`. |
| `app/styles/components.css` | Superfícies, botões, formulários, avisos, pills, estatísticas, tabelas, disclosure, progresso, estados vazios, listas chave-valor. |
| `app/styles/layout.css` | Barra de navegação (vidro), menu mobile, rodapé, shell e navegação segmentada do dashboard. |
| `app/styles/pages.css` | Hero + painel de busca, picker/combobox, assistente de CNAE, resultados, resumo de pedido, preços, autenticação, rankings. |
| `app/styles/map.css` | Mapa Empresarial: painel lateral, palco do mapa, controles, resumo da empresa, bottom sheets no mobile. O Cesium lê as cores dos tokens em tempo de execução (`lib/map/palette.ts`). |

Regra: componentes usam **somente tokens** (`var(--label)`, `var(--space-5)`…). Nenhum hex fora de `tokens.css`.

## Tokens principais

- **Acento**: Azul BuscaCNAE `#0A5CE6` (claro) / `#4C9BFF` (escuro) — contraste ≥ 4.5:1.
- **Texto**: `--label`, `--label-secondary`, `--label-tertiary` (por papel, nunca cinza solto).
- **Fundos**: `--bg`, `--bg-secondary` (tiles), `--bg-elevated` (cards, popovers), `--bg-inset` (campos desabilitados).
- **Status**: `--success`, `--warning`, `--danger` + variantes `-soft` para fundos tingidos.
- **Tipografia**: `title-hero`, `title-large`, `title-1/2/3`, `headline`, `lead`, `body`, `footnote`, `caption`, `eyebrow`, `kicker`. Tracking aperta com o tamanho; leading afrouxa em textos pequenos.
- **Espaçamento**: grade 4/8pt (`--space-1` … `--space-20`), `--section-gap`, `--gutter`.
- **Raios**: `--radius-xs` 6 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 22 · `2xl` 28 · `capsule`.
- **Movimento**: `--ease-out`, `--ease-ios`; `--duration-instant` 100ms · `fast` 180 · `base` 260 · `slow` 420.
- **Camadas**: `--z-sticky` 100 · `nav` 200 · `dropdown` 300 · `overlay` 400 · `modal` 500 · `toast` 600.
- **Breakpoints**: 640 · 820 · 1080 · 1280 px.

## Componentes

- **Botões**: `.button` (primário) · `.button-secondary` · `.button-ghost` (terciário; `.is-neutral`, `.is-destructive`) · `.button-danger` · `.button-icon`. Tamanhos `.button-sm`, `.button-lg`, `.full`. Estados: hover, active (scale .97), focus-visible, disabled, carregando (`aria-busy="true"`).
- **Superfícies**: `.tile` (agrupamento sem borda), `.card` (item elevado), `.glass` / `.glass-thick` (nav, popovers) com fallback para `prefers-reduced-transparency` e `prefers-contrast`.
- **Formulário**: `.field`, `.input`, `.textarea`, `select.input`, `.field-help`, `.field-error`, `.checkbox-inline`, `input.switch`.
- **Dados**: `.table` (+ `.table-responsive` com `data-label` para empilhar no celular), `.stat-group`, `.kv-list`, `.result-item`, `.order-summary`.
- **Feedback**: `.notice` (`.success`, `.warning`, `.danger`, `.info`), `.pill`, `.progress`, `.spinner`, `.empty-state`.
- **React**: `PageHeader`, `SectionHeader`, `AuthCard`, `SubmitButton`, `ProgressBar`, ícones (`components/ui`); `SearchSubmitButton`, `DashboardNav`, `SiteMobileNav`.
