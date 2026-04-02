"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleSignOut() {
    startTransition(async () => {
      await fetch("/api/auth/sign-out", { method: "POST" });
      router.refresh();
      router.push("/");
    });
  }

  return (
    <button type="button" onClick={handleSignOut} className="button-ghost" disabled={pending}>
      {pending ? "Saindo..." : "Sair"}
    </button>
  );
}
