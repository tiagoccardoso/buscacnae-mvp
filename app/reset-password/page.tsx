import Link from "next/link";
import { resetPasswordAction } from "@/app/sign-in/server-actions";
import { buildPageMetadata } from "@/lib/seo";
import { AuthCard } from "@/components/ui/auth-card";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata = buildPageMetadata({
  title: "Redefinir senha",
  description: "Defina uma nova senha para sua conta BuscaCNAE.",
  path: "/reset-password",
  robots: { index: false, follow: false }
});

type ResetPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = searchParams ? await searchParams : {};
  const token = typeof params.token === "string" ? params.token : "";
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <main className="page">
      <div className="container">
        <AuthCard
          title="Redefinir senha"
          subtitle="Crie uma nova senha para voltar a acessar sua conta."
          footer={
            <>
              <Link href="/forgot-password">Solicitar novo link</Link>
              <Link href="/sign-in">Voltar ao login</Link>
            </>
          }
        >
          {!token ? (
            <div className="notice danger" role="alert">Token de recuperação ausente ou inválido. Solicite uma nova recuperação de senha.</div>
          ) : null}
          {error ? <div className="notice danger" role="alert">{error}</div> : null}

          {token ? (
            <form action={resetPasswordAction} className="auth-form">
              <input type="hidden" name="token" value={token} />
              <div className="field">
                <label htmlFor="password">Nova senha</label>
                <input id="password" name="password" type="password" className="input" placeholder="Mínimo de 8 caracteres" autoComplete="new-password" minLength={8} required />
              </div>
              <div className="field">
                <label htmlFor="confirmPassword">Confirmar nova senha</label>
                <input id="confirmPassword" name="confirmPassword" type="password" className="input" placeholder="Repita a nova senha" autoComplete="new-password" minLength={8} required />
              </div>
              <SubmitButton pendingLabel="Salvando...">Salvar nova senha</SubmitButton>
            </form>
          ) : null}
        </AuthCard>
      </div>
    </main>
  );
}
