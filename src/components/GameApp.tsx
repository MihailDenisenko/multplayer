"use client";

// Корневой клиентский компонент: хранит сессию, опрашивает сервер и переключает экраны.
import { useCallback, useEffect, useRef, useState } from "react";
import HomeScreen from "./HomeScreen";
import WaitingRoom from "./WaitingRoom";
import GameScreen from "./GameScreen";
import ResultsScreen from "./ResultsScreen";
import { ApiError, apiFetchState, clearSession, loadSession, saveSession } from "@/lib/game/client";
import type { StateResponseDTO } from "@/lib/game/types";

const POLL_INTERVAL_MS = 500;

export default function GameApp() {
  const [inviteCode, setInviteCode] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [state, setState] = useState<StateResponseDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateState = useCallback((next: StateResponseDTO) => {
    setState(previous => previous?.room.code === next.room.code && previous.room.foldsDone > next.room.foldsDone ? previous : next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hostname = window.location.hostname;
    const temporaryOrLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname) || /\.(lhr\.life|trycloudflare\.com)$/.test(hostname);
    const fallback = temporaryOrLocal ? "" : window.location.origin;
    async function refreshConnection() {
      try {
        const response = await fetch("/api/connection", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("Connection status unavailable");
        const connection = await response.json();
        if (!cancelled) setAppUrl(connection.publicUrl || fallback);
      } catch {
        if (!cancelled) setAppUrl(fallback);
      }
    }
    void refreshConnection();
    const timer = setInterval(refreshConnection, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Восстанавливаем идентификаторы сразу; состояние догрузит устойчивый polling.
  useEffect(() => {
    const requestedCode = new URL(window.location.href).searchParams.get("room")?.trim().toUpperCase() ?? "";
    const validCode = /^[A-Z0-9]{6}$/.test(requestedCode) ? requestedCode : "";
    setInviteCode(validCode);
    const session = loadSession();
    if (session && (!validCode || validCode === session.roomCode)) {
      setToken(session.token);
      setRoomCode(session.roomCode);
    } else if (session && validCode !== session.roomCode) {
      clearSession();
    }
    setLoading(false);
  }, []);

  // Следующий запрос начинается только после завершения предыдущего.
  useEffect(() => {
    if (!token || !roomCode) return;
    let cancelled = false;
    let sessionInvalid = false;

    const poll = async () => {
      try {
        const next = await apiFetchState(roomCode, token);
        if (!cancelled) {
          updateState(next);
          setConnectionLost(false);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status !== null && [401, 403, 404].includes(error.status)) {
          sessionInvalid = true;
          clearSession();
          setToken(null);
          setRoomCode(null);
          setState(null);
          setConnectionLost(false);
          setError(error.message);
        } else {
          setConnectionLost(true);
        }
      } finally {
        if (!cancelled && !sessionInvalid) {
          pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(poll, 0);
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [token, roomCode, updateState]);

  const handleReady = useCallback((newToken: string, newRoomCode: string, newState: StateResponseDTO) => {
    saveSession({ token: newToken, roomCode: newRoomCode });
    setToken(newToken);
    setRoomCode(newRoomCode);
    setState(newState);
    setConnectionLost(false);
    const url = new URL(window.location.href);
    url.searchParams.set("room", newRoomCode);
    window.history.replaceState(null, "", url);
  }, []);

  const handleLeave = useCallback(() => {
    clearSession();
    setToken(null);
    setRoomCode(null);
    setState(null);
    setInviteCode("");
    setError(null);
    setConnectionLost(false);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const handleError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-amber-200">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500/30 border-t-amber-400" />
      </div>
    );
  }

  if (token && roomCode && !state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500/30 border-t-amber-400" />
        <p className="text-lg font-semibold">Восстанавливаем игру {roomCode}…</p>
        <p className="max-w-md text-sm text-slate-300">Сессия сохранена. Страница подключится автоматически, когда сервер снова станет доступен.</p>
        <button type="button" onClick={handleLeave} className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800">В главное меню</button>
      </div>
    );
  }

  return (
    <>
      {connectionLost && (
        <div className="fixed left-1/2 top-14 z-50 -translate-x-1/2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black shadow-lg">
          Соединение потеряно. Повторяем подключение…
        </div>
      )}
      {error && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      {!token || !roomCode || !state ? (
        <HomeScreen initialRoomCode={inviteCode} onReady={handleReady} />
      ) : state.room.status === "lobby" ? (
        <WaitingRoom state={state} token={token} appUrl={appUrl} onError={handleError} onLeave={handleLeave} />
      ) : state.room.status === "playing" ? (
        <GameScreen state={state} token={token} onError={handleError} onState={updateState} />
      ) : (
        <ResultsScreen state={state} token={token} onLeave={handleLeave} />
      )}
    </>
  );
}
