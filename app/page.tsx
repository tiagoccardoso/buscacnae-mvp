import Link from "next/link";
import { SearchFilterBuilder } from "@/components/search-filter-builder";
import { PremiumHeroStage } from "@/components/premium-hero-stage";
import { SearchImmersiveStage } from "@/components/search-immersive-stage";
import { OnboardingCorporate } from "@/components/onboarding-corporate";
import { PublicSearchSubmitButton } from "@/components/public-search-submit-button";
import { startPublicSearchAction } from "@/app/home-actions";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <main className="page">
      <section className="container hero-premium-stack">
        <div className="hero-premium-copy surface-premium card-lg stack">
          <span className="eyebrow">Pesquisa pública de empresas</span>
          <h1 className="display-title">
            Encontre empresas por <span className="gradient-text">CNAE, estado e cidade com preço por resultado</span>.
          </h1>
          <p className="lead-copy">
            Escolha os filtros, veja quantos leads foram encontrados em cada faixa de valor e pague conforme a composição da lista: <strong>R$ 0,05 básico, R$ 0,10 com telefone, R$ 0,15 com e-mail e R$ 0,20 completo</strong>.
            Depois do pagamento, o cliente visualiza os resultados online e pode baixar o arquivo em XLSX.
          </p>

          <div className="inline-list">
            <span className="pill">Pesquisa pública</span>
            <span className="pill">Preço por tipo de lead</span>
            <span className="pill">Dashboard opcional</span>
          </div>

          <div className="hero-signal-grid">
            <div className="signal-card">
              <span className="kicker">Entrada imediata</span>
              <strong>Sem fricção</strong>
              <span className="muted">O usuário já começa pela pesquisa, sem depender do dashboard.</span>
            </div>
            <div className="signal-card">
              <span className="kicker">Preço claro</span>
              <strong>Valor por resultado</strong>
              <span className="muted">Só paga pelos CNPJs realmente encontrados no recorte escolhido.</span>
            </div>
            <div className="signal-card">
              <span className="kicker">Decisão rápida</span>
              <strong>Mais clareza</strong>
              <span className="muted">A tela foi organizada para facilitar a escolha dos filtros e a leitura do resultado.</span>
            </div>
          </div>
        </div>

        <PremiumHeroStage />
      </section>

      <section className="container immersive-search-section">
        <div className="immersive-search-layout surface-premium card-lg">
          <div className="immersive-search-form-side">
            <div className="stack immersive-search-copy" style={{ gap: 8 }}>
              <span className="eyebrow">Monte sua pesquisa</span>
              <h2 className="section-title immersive-search-title">Uma tela ampla para montar pesquisas com mais clareza.</h2>
              <p className="section-copy">
                Combine vários CNAEs, estados e cidades na mesma pesquisa, acompanhe o que já foi selecionado com clareza e use o chat para encontrar CNAEs mais rápido.
              </p>
            </div>

            {error ? <div className="notice danger">{error}</div> : null}

            <form action={startPublicSearchAction} className="stack immersive-search-form">
              <div className="public-form-grid public-form-grid-wide">
                <div className="field">
                  <label htmlFor="email">Email para receber o acesso da pesquisa</label>
                  <input id="email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" required />
                </div>
              </div>

              <SearchFilterBuilder />

              <div className="home-form-actions home-form-actions-premium immersive-submit-row">
                <PublicSearchSubmitButton />
                <span className="tiny">
                  Você só paga pelos leads encontrados. Depois da busca, a próxima tela mostra a quantidade total, a distribuição por faixa de valor e o total antes do checkout.
                </span>
              </div>
            </form>
          </div>

          <div className="immersive-search-visual-side">
            <SearchImmersiveStage />
            <div className="immersive-search-benefits">
              <div className="signal-card">
                <span className="kicker">Múltiplas seleções</span>
                <strong>CNAEs, UFs e cidades em paralelo</strong>
                <span className="muted">Escolha vários filtros ao mesmo tempo sem perder a organização da pesquisa.</span>
              </div>
              <div className="signal-card">
                <span className="kicker">Leitura espacial</span>
                <strong>Mais área útil para decidir</strong>
                <span className="muted">Mais espaço para conferir as escolhas antes de buscar e liberar a lista.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container stack" style={{ marginTop: 28 }}>
        <div className="surface-premium card-lg panel-grid two">
          <div className="stack" style={{ gap: 12 }}>
            <span className="eyebrow">O que você recebe</span>
            <h2 className="section-title">Uma jornada simples para equipes que precisam agir rápido.</h2>
            <ul className="feature-list">
              <li>Filtro por CNAE, estado e cidade com leitura clara.</li>
              <li>Sugestões automáticas para preencher filtros com mais rapidez.</li>
              <li>Checkout proporcional à composição dos leads encontrados.</li>
              <li>Visualização online e download da lista em XLSX.</li>
              <li>Dashboard opcional para histórico e detalhamento.</li>
            </ul>
          </div>

          <div className="stack action-stage">
            <div className="notice">
              <strong>Pesquisa pública</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                Entre direto pelo formulário e siga para a lista quando a quantidade encontrada fizer sentido para o seu objetivo.
              </p>
            </div>
            <div className="notice">
              <strong>Histórico opcional</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                Use o dashboard para revisar pesquisas, consultar listas anteriores e acompanhar a operação quando isso fizer sentido.
              </p>
            </div>
            <div className="inline-actions">
              <Link href="/pricing" className="button-ghost">
                Ver como funciona
              </Link>
              <Link href="/onboarding" className="button-secondary">
                Ver onboarding corporativo
              </Link>
            </div>
          </div>
        </div>

        <OnboardingCorporate />
      </section>
    </main>
  );
}
