import { LEAD_PRICING_TABLE } from "@/lib/lead-pricing";
import { formatMoney } from "@/lib/format";
import { getAppName, getMinimumCheckoutAmountCents, getPublicContactEmail } from "@/lib/env";

export const marketingVocabulary = {
  search: "pesquisa",
  list: "lista",
  lead: "lead",
  preview: "prévia",
  batch: "lote",
  checkout: "checkout",
  dashboard: "dashboard",
  history: "histórico",
  reorder: "recompra",
  download: "download",
  filters: "filtros"
};

export const pricingTiers = LEAD_PRICING_TABLE.map((tier) => ({
  ...tier,
  formattedUnitPrice: formatMoney(tier.unitAmountCents / 100)
}));

export const minimumCheckoutAmount = formatMoney(getMinimumCheckoutAmountCents() / 100);
export const publicContactEmail = getPublicContactEmail();

export const homeHighlights = [
  "Pesquisa pública sem login obrigatório",
  "Prévia com volume e preço antes do pagamento",
  "Compra avulsa por lote",
  "Entrega online e em XLSX",
  "Dashboard opcional para histórico e recompra"
];

export const trustItems = [
  {
    title: "Preço transparente antes do pagamento",
    copy: `A prévia mostra a composição do lote por tipo de lead e o total do pedido. Há mínimo operacional de ${minimumCheckoutAmount} por pedido com resultados.`
  },
  {
    title: "Dados consolidados para uso comercial",
    copy: "A lista reúne dados cadastrais, localidade, status da empresa e sinais de contato quando disponíveis no retorno dos provedores integrados."
  },
  {
    title: "Entrega previsível",
    copy: "Depois da confirmação do pagamento, a lista fica disponível online e pronta para download em XLSX na mesma jornada."
  },
  {
    title: "Dashboard opcional",
    copy: "O dashboard serve para histórico, revisão, leads salvos e recompra. A pesquisa principal continua pública e direta."
  }
];

export const deliveryPreviewColumns = [
  "Razão social e nome fantasia",
  "CNPJ",
  "Cidade e UF",
  "Situação cadastral",
  "Telefone quando disponível",
  "E-mail quando disponível",
  "Endereço quando disponível",
  "Download em XLSX após pagamento"
];

export const commercialFaqItems = [
  {
    question: "Como o preço é calculado?",
    answer: `O valor é calculado por tipo de lead encontrado na busca: ${pricingTiers.map((tier) => `${tier.label} ${tier.formattedUnitPrice}`).join(", ")}. Se a composição ficar abaixo de ${minimumCheckoutAmount}, o checkout aplica esse mínimo operacional.`
  },
  {
    question: "O que eu vejo antes de pagar?",
    answer: "Você vê o total de resultados, a composição do lote por tipo de lead, o valor total e uma amostra da lista antes de seguir para o checkout."
  },
  {
    question: "Quando eu pago?",
    answer: "Você só paga depois da pesquisa e da prévia. O checkout é a etapa final da jornada."
  },
  {
    question: "O que eu recebo após o pagamento?",
    answer: "A lista completa fica liberada online e pronta para download em XLSX, com os campos disponíveis para cada registro retornado."
  },
  {
    question: "Preciso criar conta para pesquisar?",
    answer: "Não. A pesquisa pública funciona sem login. A conta entra para histórico, recompra e organização das listas no dashboard."
  },
  {
    question: "De onde vêm os dados?",
    answer: "O produto consolida dados de provedores integrados e da base interna do sistema. A página de dados explica origem, composição, atualização e limites do material entregue."
  },
  {
    question: "A lista sempre terá telefone e e-mail?",
    answer: "Não. Isso depende do que foi encontrado para cada empresa. Por isso a cobrança é separada por tipo de lead e a prévia mostra a composição real do lote."
  },
  {
    question: "Posso recomprar ou repetir uma busca?",
    answer: "Sim. O dashboard guarda histórico, listas liberadas, leads salvos e atalhos para repetir buscas com o mesmo recorte."
  },
  {
    question: "A busca pode usar cache?",
    answer: "Sim. Para ganhar velocidade e consistência operacional, algumas consultas podem aproveitar resultados recentes já consolidados pelo sistema."
  },
  {
    question: "Como falo com o time?",
    answer: `Você pode falar pelo e-mail ${publicContactEmail}. Também deixamos a página de contato acessível no rodapé.`
  }
];

export const useCasePages = [
  {
    slug: "representacao-comercial",
    menuLabel: "Representação comercial",
    heroEyebrow: "Casos de uso",
    title: "Leads para representação comercial por CNAE e região",
    description: "Monte listas por segmento, estado e cidade para expandir carteira, mapear território e priorizar prospecção com preço transparente antes do pagamento.",
    intentTitle: "Use quando você precisa abrir território comercial com recorte claro.",
    bullets: [
      "Separar regiões por estado ou cidade",
      "Buscar indústrias, varejo ou serviços por CNAE",
      "Priorizar listas com telefone e e-mail",
      "Repetir buscas no dashboard para novas rodadas"
    ],
    benefits: [
      "Recorte por atividade econômica real",
      "Preço antes do checkout",
      "Prévia da qualidade do lote",
      "Dashboard útil para recompra"
    ]
  },
  {
    slug: "distribuidoras",
    menuLabel: "Distribuidoras",
    heroEyebrow: "Casos de uso",
    title: "Leads para distribuidoras encontrarem revendas, varejo e contas por região",
    description: "Descubra empresas por CNAE e território para campanhas de expansão, cobertura de rota e prospecção de novos pontos de venda.",
    intentTitle: "Use quando a operação precisa ganhar capilaridade e manter cobertura comercial.",
    bullets: [
      "Listas por estado inteiro ou cidades-chave",
      "Segmentação por nicho de varejo ou revenda",
      "Filtros por telefone, endereço e porte",
      "Histórico pronto para repetir campanhas"
    ],
    benefits: [
      "Mapeamento regional mais rápido",
      "Compra só do lote que fizer sentido",
      "Lista pronta para repasse ao time comercial",
      "Reuso de filtros no dashboard"
    ]
  },
  {
    slug: "franquias",
    menuLabel: "Franquias",
    heroEyebrow: "Casos de uso",
    title: "Leads para franquias prospectarem candidatos e pontos por perfil de negócio",
    description: "Cruze CNAE e região para encontrar empresas alinhadas com expansão, parceiros locais e oportunidades por praça.",
    intentTitle: "Use quando a franquia precisa abrir novas praças com critério comercial.",
    bullets: [
      "Mapear mercados por cidade ou estado",
      "Encontrar empresas com aderência ao segmento",
      "Comparar volume e preço antes da compra",
      "Salvar listas para novas rodadas de contato"
    ],
    benefits: [
      "Mais clareza por praça",
      "Menos desperdício na compra de listas",
      "Fluxo simples para times de expansão",
      "Histórico centralizado"
    ]
  },
  {
    slug: "contabilidade-bpo",
    menuLabel: "Contabilidade e BPO",
    heroEyebrow: "Casos de uso",
    title: "Leads para contabilidade e BPO por segmento, porte e região",
    description: "Monte listas por CNAE, porte, Simples Nacional e localidade para prospecção consultiva com mais aderência ao perfil do cliente.",
    intentTitle: "Use quando sua operação precisa de listas com filtros mais comerciais e menos genéricos.",
    bullets: [
      "Filtrar por porte da empresa",
      "Usar Simples Nacional como recorte",
      "Buscar segmentos específicos por CNAE",
      "Salvar carteiras por nicho no dashboard"
    ],
    benefits: [
      "Melhor aderência comercial",
      "Segmentação útil para outbound",
      "Organização por carteira",
      "Recompra mais rápida"
    ]
  },
  {
    slug: "inteligencia-de-mercado",
    menuLabel: "Inteligência de mercado",
    heroEyebrow: "Casos de uso",
    title: "Inteligência de mercado por CNAE e região para mapear nichos e cobertura",
    description: "Use a busca para estimar volume de empresas por atividade e localidade antes de comprar a lista, comparando recortes com mais clareza.",
    intentTitle: "Use quando você quer medir oportunidade antes de partir para a operação.",
    bullets: [
      "Comparar mercados por estado e cidade",
      "Testar múltiplos CNAEs no mesmo fluxo",
      "Analisar volume encontrado antes de pagar",
      "Comprar só os recortes aprovados"
    ],
    benefits: [
      "Leitura mais rápida do mercado",
      "Menos compra por tentativa",
      "Mais previsibilidade no lote",
      "Amostra visível antes do checkout"
    ]
  }
] as const;

export const footerNavigation = {
  product: [
    { href: "/", label: "Pesquisar lista" },
    { href: "/pricing", label: "Preços" },
    { href: "/onboarding", label: "Como funciona" },
    { href: "/dashboard", label: "Dashboard" }
  ],
  trust: [
    { href: "/dados", label: "Dados e atualização" },
    { href: "/faq", label: "FAQ comercial" },
    { href: "/sobre", label: "Sobre" },
    { href: "/contato", label: "Contato" },
    { href: "/privacidade", label: "Privacidade" },
    { href: "/termos", label: "Termos de uso" }
  ],
  useCases: useCasePages.map((page) => ({
    href: `/solucoes/${page.slug}`,
    label: page.menuLabel
  }))
};

export const aboutHighlights = [
  "Busca pública para encontrar empresas por CNAE e região",
  "Filtro por estado, cidade e sinais de contato",
  "Prévia com volume e preço antes do checkout",
  "Liberação da lista após pagamento",
  "Dashboard opcional para histórico, leads salvos e recompra"
];

export function getBusinessShortDescription() {
  return `O ${getAppName()} ajuda equipes comerciais a descobrir, filtrar e comprar listas B2B por CNAE e região com preço transparente antes do pagamento.`;
}
