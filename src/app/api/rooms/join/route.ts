// POST /api/rooms/join — подключение игрока к существующей комнате по коду.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { players, rooms } from "@/db/schema";
import { generatePlayerToken } from "@/lib/game/logic";
import { buildStateForPlayer } from "@/lib/game/server";

export const dynamic = "force-dynamic";

interface JoinRoomBody {
  code?: string;
  name?: string;
  avatar?: string | null;
}

export async function POST(req: Request) {
  let body: JoinRoomBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const code = (body.code ?? "").trim().toUpperCase();
  const name = (body.name ?? "").trim().slice(0, 40);

  if (!code) return Response.json({ error: "Укажите код комнаты" }, { status: 400 });
  if (!name) return Response.json({ error: "Укажите имя игрока" }, { status: 400 });

  const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
  if (!room) return Response.json({ error: "Комната с таким кодом не найдена" }, { status: 404 });
  if (room.status !== "lobby") {
    return Response.json({ error: "Игра в этой комнате уже началась" }, { status: 409 });
  }

  const existingPlayers = await db.select().from(players).where(eq(players.roomId, room.id));
  if (existingPlayers.length >= room.maxPlayers) {
    return Response.json({ error: "Комната уже заполнена" }, { status: 409 });
  }
  if (existingPlayers.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return Response.json({ error: "Игрок с таким именем уже в комнате" }, { status: 409 });
  }

  const seat = existingPlayers.length;
  const token = generatePlayerToken();

  const [player] = await db
    .insert(players)
    .values({
      roomId: room.id,
      token,
      name,
      avatar: body.avatar ?? null,
      seat,
      isHost: false,
    })
    .returning();

  // Защита от гонки: повторно проверим вместимость после вставки.
  const countAfter = await db.select().from(players).where(eq(players.roomId, room.id));
  if (countAfter.length > room.maxPlayers) {
    await db.delete(players).where(and(eq(players.id, player.id)));
    return Response.json({ error: "Комната уже заполнена" }, { status: 409 });
  }

  const state = await buildStateForPlayer(player);
  return Response.json({ token, roomCode: room.code, state });
}
