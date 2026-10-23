import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

function origin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch { return null; }
}

export async function GET() {
  let publicUrl: string | null = null;
  let status = "offline";
  try {
    const state = JSON.parse(await readFile(path.join(process.cwd(), ".local", "tunnel.json"), "utf8"));
    const age = Date.now() - Date.parse(state.checkedAt);
    if (age >= 0 && age < 60_000) {
      status = state.status === "ready" ? "ready" : "connecting";
      publicUrl = origin(state.publicUrl);
    }
  } catch { /* The local tunnel is optional when deployed on a permanent domain. */ }
  const configured = origin(process.env.PUBLIC_APP_URL);
  if (!publicUrl && configured && !/\.(lhr\.life|trycloudflare\.com)$/.test(new URL(configured).hostname)) {
    publicUrl = configured;
    status = "ready";
  }
  return Response.json({ publicUrl, status }, { headers: { "Cache-Control": "no-store" } });
}
