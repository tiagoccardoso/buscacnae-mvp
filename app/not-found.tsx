import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export default function NotFound() {
  return (
    <main className="page">
      <div className="container container-narrow">
        <PageHeader
          align="center"
          eyebrow="Erro 404"
          title="Página não encontrada."
          lead="O recurso que você tentou acessar não existe, foi movido ou ainda não foi criado neste ambiente."
          actions={
            <Link href="/" className="button">
              Voltar para a home
            </Link>
          }
        />
      </div>
    </main>
  );
}
