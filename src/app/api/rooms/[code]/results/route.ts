// GET /api/rooms/[code]/results — полные данные всех листков после завершения игры.
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { entries, rooms, sheets } from "@/db/schema";
import { extractToken, getPlayerByToken, serializeRoom } from "@/lib/game/server";
import type { ResultSheetDTO } from "@/lib/game/types";

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
  if (room.status !== "finished") {
    return Response.json({ error: "Игра ещё не завершена" }, { status: 409 });
  }

  const roomSheets = await db
    .select()
    .from(sheets)
    .where(eq(sheets.roomId, room.id))
    .orderBy(asc(sheets.id));

  const result: ResultSheetDTO[] = [];
  for (const sheet of roomSheets) {
    const sheetEntries = await db
      .select()
      .from(entries)
      .where(eq(entries.sheetId, sheet.id))
      .orderBy(asc(entries.orderIndex));

    result.push({
      sheetId: sheet.id,
      originAuthorName: sheetEntries[0]?.authorName ?? "?",
      entries: sheetEntries.map((e) => ({
        type: e.type as "question" | "answer",
        text: e.text,
        keyword: e.keyword,
        authorName: e.authorName,
      })),
    });
  }

  return Response.json({ room: serializeRoom(room), sheets: result });
}
