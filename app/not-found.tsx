import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <section className="container" style={{ maxWidth: 760 }}>
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">404</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2rem, 4vw, 3.4rem)" }}>
            Página não encontrada.
          </h1>
          <p className="lead-copy">
            O recurso que você tentou acessar não existe, foi movido ou ainda não foi criado neste ambiente.
          </p>
          <Link href="/" className="button">
            Voltar para a home
          </Link>
        </div>
      </section>
    </main>
  );
}
