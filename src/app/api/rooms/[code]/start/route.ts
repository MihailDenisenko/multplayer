// POST /api/rooms/[code]/start — ведущий запускает игру: создаются листки для всех игроков.
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { players, rooms, sheets } from "@/db/schema";
import { extractToken, getPlayerByToken } from "@/lib/game/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
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
  if (!player.isHost) {
    return Response.json({ error: "Только ведущий может начать игру" }, { status: 403 });
  }
  if (room.status !== "lobby") {
    return Response.json({ error: "Игра уже начата" }, { status: 409 });
  }

  const roomPlayers = await db
    .select()
    .from(players)
    .where(eq(players.roomId, room.id))
    .orderBy(asc(players.seat));

  if (roomPlayers.length < 3) {
    return Response.json(
      { error: "Нужно минимум 3 игрока, чтобы начать игру" },
      { status: 400 },
    );
  }

  const targetEntries = room.folds;

  await db.transaction(async (tx) => {
    for (const p of roomPlayers) {
      await tx.insert(sheets).values({
        roomId: room.id,
        originPlayerId: p.id,
        currentHolderId: p.id,
        isActiveForHolder: true,
        targetEntries,
        status: "active",
      });
    }
    await tx.update(rooms).set({ status: "playing", foldsDone: 0 }).where(eq(rooms.id, room.id));
  });

  return Response.json({ ok: true });
}
