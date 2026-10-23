// Одна принятая отправка — один загиб текущего листка.
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { entries, players, rooms, sheets } from "@/db/schema";
import { getSheetStage, nextSeatIndex } from "@/lib/game/logic";
import { buildStateForPlayer, extractToken, getPlayerByToken } from "@/lib/game/server";

export const dynamic = "force-dynamic";

interface SubmitBody {
  sheetId?: number;
  answerText?: string;
  questionText?: string;
  keyword?: string;
}

class SubmissionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function sanitize(input: unknown, max: number): string {
  return typeof input === "string" ? input.trim().slice(0, max) : "";
}

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const token = extractToken(req);
  if (!token) return Response.json({ error: "Нет токена авторизации" }, { status: 401 });
  const player = await getPlayerByToken(token);
  if (!player) return Response.json({ error: "Игрок не найден" }, { status: 404 });

  let body: SubmitBody;
  try {
    body = await req.json();
    if (!body || typeof body !== "object") throw new Error("INVALID_INPUT");
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const sheetId = Number(body.sheetId);
  if (!Number.isSafeInteger(sheetId) || sheetId <= 0) {
    return Response.json({ error: "Не указан листок" }, { status: 400 });
  }

  try {
    await db.transaction(async (tx) => {
      // Блокировка комнаты сериализует одновременные загибы с разных устройств.
      // Лимит и принадлежность листка проверяются заново уже под блокировкой.
      const [room] = await tx.select().from(rooms)
        .where(eq(rooms.id, player.roomId)).for("update");
      if (!room || room.code !== code.toUpperCase()) {
        throw new SubmissionError("Игрок не принадлежит этой комнате", 403);
      }
      if (room.status !== "playing") {
        throw new SubmissionError("Игра уже завершена или ещё не началась", 409);
      }
      const [sheet] = await tx.select().from(sheets).where(eq(sheets.id, sheetId));
      if (!sheet || sheet.roomId !== room.id) throw new SubmissionError("Листок не найден", 404);
      if (sheet.currentHolderId !== player.id || !sheet.isActiveForHolder || sheet.status !== "active" || sheet.foldsDone >= room.folds) {
        throw new SubmissionError("Этот листок сейчас не у вас", 403);
      }
      const sheetEntries = await tx.select().from(entries).where(eq(entries.sheetId, sheet.id));
      const count = sheetEntries.length;
      const stage = getSheetStage(count, room.folds - sheet.foldsDone);
      const answerText = sanitize(body.answerText, 300);
      const questionText = sanitize(body.questionText, 300);
      const keyword = sanitize(body.keyword, 60);
      if ((stage !== "question_only" && !answerText) || (stage !== "final_answer" && (!questionText || !keyword))) {
        throw new SubmissionError("Заполните все поля текущего хода", 400);
      }
      const author = { sheetId: sheet.id, authorId: player.id, authorName: player.name };
      if (stage !== "question_only") {
        await tx.insert(entries).values({ ...author, orderIndex: count, type: "answer", text: answerText, keyword: null });
      }
      if (stage !== "final_answer") {
        await tx.insert(entries).values({ ...author, orderIndex: count + (stage === "question_only" ? 0 : 1), type: "question", text: questionText, keyword });
      }
      const foldsDone = sheet.foldsDone + 1;
      const sheetFinished = foldsDone === room.folds;
      await tx.update(sheets).set({ foldsDone, ...(sheetFinished ? { status: "finished", isActiveForHolder: false } : {}) }).where(eq(sheets.id, sheet.id));
      const [unfinished] = await tx.select({ id: sheets.id }).from(sheets).where(and(eq(sheets.roomId, room.id), eq(sheets.status, "active"))).limit(1);
      await tx.update(rooms).set({ foldsDone: room.foldsDone + 1, status: unfinished ? "playing" : "finished" }).where(eq(rooms.id, room.id));
      if (!sheetFinished) {
      const roomPlayers = await tx.select().from(players).where(eq(players.roomId, room.id)).orderBy(asc(players.seat));
      const nextSeat = nextSeatIndex(player.seat, roomPlayers.length, room.direction as "cw" | "ccw");
      const nextPlayer = roomPlayers.find(p => p.seat === nextSeat);
      if (!nextPlayer) throw new Error("Next player missing");
      const activeAtTarget = await tx.select({ id: sheets.id }).from(sheets).where(and(
        eq(sheets.roomId, room.id), eq(sheets.currentHolderId, nextPlayer.id),
        eq(sheets.isActiveForHolder, true), eq(sheets.status, "active"), ne(sheets.id, sheet.id),
      )).limit(1);
      await tx.update(sheets).set({
        currentHolderId: nextPlayer.id, isActiveForHolder: activeAtTarget.length === 0, arrivedAt: new Date(),
      }).where(eq(sheets.id, sheet.id));
      }
      const [queued] = await tx.select().from(sheets).where(and(
        eq(sheets.roomId, room.id), eq(sheets.currentHolderId, player.id),
        eq(sheets.isActiveForHolder, false), eq(sheets.status, "active"),
      )).orderBy(asc(sheets.arrivedAt), asc(sheets.id)).limit(1);
      if (queued) await tx.update(sheets).set({ isActiveForHolder: true }).where(eq(sheets.id, queued.id));
    });
  } catch (error) {
    if (error instanceof SubmissionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const state = await buildStateForPlayer(player);
  return Response.json({ ok: true, state });
}
