import { NextResponse } from "next/server";
import { GUEST_COOKIE, SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(GUEST_COOKIE);
  return res;
}
