import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/env";

export async function POST() {
  return NextResponse.redirect(
    new URL("/dashboard?reason=O produto está configurado apenas para pagamento avulso.", getBaseUrl()),
    303
  );
}
