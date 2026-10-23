// Серверные помощники для работы с игрой: чтение состояния, авторизация по токену.
// Используется только в API route-обработчиках (выполняется на сервере).

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { entries, players, rooms, sheets } from "@/db/schema";
import { getSheetStage, prevSeatIndex } from "./logic";
import type {
  MySheetDTO,
  PlayerActivity,
  PlayerPublicDTO,
  RoomSettingsDTO,
  StateResponseDTO,
} from "./types";

const OFFLINE_MS = 12_000;

export type PlayerRow = typeof players.$inferSelect;
export type RoomRow = typeof rooms.$inferSelect;
export type SheetRow = typeof sheets.$inferSelect;

/** Достаёт токен игрока из заголовка Authorization или query-параметра. */
export function extractToken(req: Request): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

/** Находит игрока по токену и обновляет lastSeenAt (для определения онлайн-статуса). */
export async function getPlayerByToken(token: string): Promise<PlayerRow | null> {
  const [player] = await db.select().from(players).where(eq(players.token, token)).limit(1);
  if (!player) return null;
  await db.update(players).set({ lastSeenAt: new Date() }).where(eq(players.id, player.id));
  return player;
}

export function serializeRoom(room: RoomRow): RoomSettingsDTO {
  return {
    code: room.code,
    status: room.status as RoomSettingsDTO["status"],
    maxPlayers: room.maxPlayers,
    folds: room.folds,
    foldsDone: room.foldsDone,
    direction: room.direction as RoomSettingsDTO["direction"],
    style: room.style as RoomSettingsDTO["style"],
    showFirstAuthor: room.showFirstAuthor,
  };
}

/** Собирает полное состояние для конкретного игрока (без утечки скрытого текста). */
export async function buildStateForPlayer(me: PlayerRow): Promise<StateResponseDTO | null> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, me.roomId)).limit(1);
  if (!room) return null;

  const roomPlayers = await db
    .select()
    .from(players)
    .where(eq(players.roomId, room.id))
    .orderBy(asc(players.seat));

  const roomSheets = await db.select().from(sheets).where(eq(sheets.roomId, room.id));

  const now = Date.now();
  const activityByPlayerId = new Map<number, PlayerActivity>();
  for (const p of roomPlayers) {
    let activity: PlayerActivity = "waiting";
    if (room.status === "finished") {
      activity = "done";
    } else if (room.status === "playing") {
      const hasActiveSheet = roomSheets.some(
        (s) => s.currentHolderId === p.id && s.isActiveForHolder && s.status === "active",
      );
      activity = hasActiveSheet ? "writing" : "waiting";
    } else {
      activity = "waiting";
    }
    if (now - new Date(p.lastSeenAt).getTime() > OFFLINE_MS && p.id !== me.id) {
      activity = "offline";
    }
    activityByPlayerId.set(p.id, activity);
  }

  const playerDTOs: PlayerPublicDTO[] = roomPlayers.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    seat: p.seat,
    isHost: p.isHost,
    activity: activityByPlayerId.get(p.id) ?? "waiting",
    isMe: p.id === me.id,
  }));

  let mySheet: MySheetDTO | null = null;
  let waitingForName: string | null = null;

  const myActiveSheet = roomSheets.find(
    (s) => s.currentHolderId === me.id && s.isActiveForHolder && s.status === "active",
  );

  if (myActiveSheet) {
    const sheetEntries = await db
      .select()
      .from(entries)
      .where(eq(entries.sheetId, myActiveSheet.id))
      .orderBy(asc(entries.orderIndex));

    const count = sheetEntries.length;
    const stage = getSheetStage(count, room.folds - myActiveSheet.foldsDone);
    const lastQuestion = [...sheetEntries].reverse().find((e) => e.type === "question");

    mySheet = {
      sheetId: myActiveSheet.id,
      stage,
      keyword: stage === "question_only" ? null : lastQuestion?.keyword ?? null,
      firstAuthorName: room.showFirstAuthor ? (sheetEntries[0]?.authorName ?? null) : null,
      progress: { count: myActiveSheet.foldsDone, target: room.folds },
      foldsDone: myActiveSheet.foldsDone,
      receivedFromName:
        sheetEntries.length > 0 ? sheetEntries[sheetEntries.length - 1].authorName : null,
    };
  } else if (room.status === "playing") {
    const prevSeat = prevSeatIndex(me.seat, roomPlayers.length, room.direction as "cw" | "ccw");
    const prevPlayer = roomPlayers.find((p) => p.seat === prevSeat);
    waitingForName = prevPlayer?.name ?? null;
  }

  const queuedCount = roomSheets.filter(
    (s) => s.currentHolderId === me.id && !s.isActiveForHolder && s.status === "active",
  ).length;

  return {
    room: serializeRoom(room),
    players: playerDTOs,
    me: { id: me.id, name: me.name, seat: me.seat, isHost: me.isHost },
    mySheet,
    waitingForName,
    queuedCount,
    sheetsProgress: { finished: roomSheets.filter(s => s.status === "finished").length, total: roomSheets.length },
    finished: room.status === "finished",
  };
}
