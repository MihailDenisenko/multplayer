// POST /api/rooms — создание новой комнаты ведущим.
import { db } from "@/db";
import { players, rooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  clamp,
  generatePlayerToken,
  generateRoomCode,
  MAX_FOLDS,
  MAX_PLAYERS,
  MIN_FOLDS,
  MIN_PLAYERS,
} from "@/lib/game/logic";
import { buildStateForPlayer } from "@/lib/game/server";

export const dynamic = "force-dynamic";

interface CreateRoomBody {
  name?: string;
  avatar?: string | null;
  maxPlayers?: number;
  folds?: number;
  direction?: "cw" | "ccw";
  style?: "realistic" | "cartoon";
  showFirstAuthor?: boolean;
}

export async function POST(req: Request) {
  let body: CreateRoomBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 40);
  if (!name) {
    return Response.json({ error: "Укажите имя игрока" }, { status: 400 });
  }

  const maxPlayers = clamp(Math.round(body.maxPlayers ?? 6), MIN_PLAYERS, MAX_PLAYERS);
  const folds = clamp(Math.round(body.folds ?? 12), MIN_FOLDS, MAX_FOLDS);
  const direction = body.direction === "ccw" ? "ccw" : "cw";
  const style = body.style === "cartoon" ? "cartoon" : "realistic";
  const showFirstAuthor = body.showFirstAuthor !== false;

  // Генерируем уникальный код комнаты (проверяем на коллизии).
  let code = generateRoomCode();
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
    if (existing.length === 0) break;
    code = generateRoomCode();
  }

  const [room] = await db
    .insert(rooms)
    .values({
      code,
      status: "lobby",
      maxPlayers,
      folds,
      direction,
      style,
      showFirstAuthor,
    })
    .returning();

  const token = generatePlayerToken();
  const [player] = await db
    .insert(players)
    .values({
      roomId: room.id,
      token,
      name,
      avatar: body.avatar ?? null,
      seat: 0,
      isHost: true,
    })
    .returning();

  const state = await buildStateForPlayer(player);

  return Response.json({ token, roomCode: room.code, state });
}
