import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";

export async function POST() {
  await auth.signOut();

  return NextResponse.json({ ok: true });
}
