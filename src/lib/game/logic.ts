// Чистые функции игровой логики "Чепухи", не зависящие от БД и сети.
// Вынесены отдельно, чтобы их было легко переиспользовать в разных роутах.

import crypto from "crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без похожих символов (O/0, I/1)

/** Генерирует случайный 6-значный буквенно-цифровой код комнаты. */
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

/** Генерирует секретный токен игрока (хранится в localStorage клиента). */
export function generatePlayerToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export type SheetStage = "question_only" | "answer_and_question" | "final_answer";

/**
 * Определяет, что должен сделать игрок, держащий листок, на основании
 * количества записей на листке и оставшихся загибов этого листка.
 * Одна отправка (вопрос или ответ с новым вопросом) — один загиб.
 * На последнем загибе дописываем только ответ, если на листке уже есть вопрос.
 */
export function getSheetStage(count: number, remainingFolds: number): SheetStage {
  if (count <= 0) return "question_only";
  if (remainingFolds <= 1) return "final_answer";
  return "answer_and_question";
}

/** Вычисляет индекс следующего места за столом с учётом направления передачи. */
export function nextSeatIndex(currentSeat: number, totalSeats: number, direction: "cw" | "ccw"): number {
  if (direction === "cw") {
    return (currentSeat + 1) % totalSeats;
  }
  return (currentSeat - 1 + totalSeats) % totalSeats;
}

/** Вычисляет индекс предыдущего места (откуда к нам приходит листок). */
export function prevSeatIndex(currentSeat: number, totalSeats: number, direction: "cw" | "ccw"): number {
  if (direction === "cw") {
    return (currentSeat - 1 + totalSeats) % totalSeats;
  }
  return (currentSeat + 1) % totalSeats;
}

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
export const MIN_FOLDS = 4;
export const MAX_FOLDS = 30;
export const RECOMMENDED_MAX_FOLDS = 15;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
