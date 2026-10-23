// Клиентские хелперы для общения с API игры.
"use client";

import type { RoomDirection, RoomStyle, StateResponseDTO } from "./types";

const STORAGE_KEY = "chepuha_session_v1";
const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("Сервер не ответил вовремя. Проверяем состояние игры…");
    }
    throw new ApiError("Соединение потеряно. Повторяем подключение…");
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface SessionInfo {
  token: string;
  roomCode: string;
}

export function saveSession(info: SessionInfo) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
}

export function loadSession(): SessionInfo | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionInfo;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

async function parseJsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : `Ошибка запроса (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data;
}

export interface CreateRoomParams {
  name: string;
  avatar: string | null;
  maxPlayers: number;
  folds: number;
  direction: RoomDirection;
  style: RoomStyle;
  showFirstAuthor: boolean;
}

export async function apiCreateRoom(params: CreateRoomParams) {
  const res = await request("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res) as Promise<{
    token: string;
    roomCode: string;
    state: StateResponseDTO;
  }>;
}

export async function apiJoinRoom(params: { code: string; name: string; avatar: string | null }) {
  const res = await request("/api/rooms/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res) as Promise<{
    token: string;
    roomCode: string;
    state: StateResponseDTO;
  }>;
}

export async function apiFetchState(roomCode: string, token: string) {
  const res = await request(`/api/rooms/${roomCode}/state?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  return parseJsonOrThrow(res) as Promise<StateResponseDTO>;
}

export async function apiStartGame(roomCode: string, token: string) {
  const res = await request(`/api/rooms/${roomCode}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  return parseJsonOrThrow(res);
}

export interface SubmitParams {
  sheetId: number;
  answerText?: string;
  questionText?: string;
  keyword?: string;
}

export async function apiSubmit(roomCode: string, token: string, params: SubmitParams) {
  const res = await request(`/api/rooms/${roomCode}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res) as Promise<{ ok: true; state: StateResponseDTO }>;
}

export async function apiFetchResults(roomCode: string, token: string) {
  const res = await request(`/api/rooms/${roomCode}/results?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  return parseJsonOrThrow(res) as Promise<{
    room: StateResponseDTO["room"];
    sheets: {
      sheetId: number;
      originAuthorName: string;
      entries: { type: "question" | "answer"; text: string; keyword: string | null; authorName: string }[];
    }[];
  }>;
}
