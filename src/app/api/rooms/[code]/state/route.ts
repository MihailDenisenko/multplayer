// GET /api/rooms/[code]/state — опрос (polling) текущего состояния игры для игрока.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { buildStateForPlayer, extractToken, getPlayerByToken } from "@/lib/game/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const token = extractToken(req);
  if (!token) return Response.json({ error: "Нет токена авторизации" }, { status: 401 });

  const player = await getPlayerByToken(token);
  if (!player) return Response.json({ error: "Игрок не найден" }, { status: 404 });

  const [room] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.code, code.toUpperCase()))
    .limit(1);
  if (!room || room.id !== player.roomId) {
    return Response.json({ error: "Игрок не принадлежит этой комнате" }, { status: 403 });
  }

  const state = await buildStateForPlayer(player);
  if (!state) return Response.json({ error: "Комната не найдена" }, { status: 404 });

  return Response.json(state);
}
