"use client";

// Корневой клиентский компонент: хранит сессию, опрашивает сервер и переключает экраны.
import { useCallback, useEffect, useRef, useState } from "react";
import HomeScreen from "./HomeScreen";
import WaitingRoom from "./WaitingRoom";
import GameScreen from "./GameScreen";
import ResultsScreen from "./ResultsScreen";
import { apiFetchState, clearSession, loadSession, saveSession } from "@/lib/game/client";
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

  // При загрузке страницы пробуем восстановить сессию из localStorage.
  useEffect(() => {
    const requestedCode = new URL(window.location.href).searchParams.get("room")?.trim().toUpperCase() ?? "";
    const validCode = /^[A-Z0-9]{6}$/.test(requestedCode) ? requestedCode : "";
    const timer = setTimeout(() => {
      setInviteCode(validCode);
    }, 0);
    const session = loadSession();
    if (!session || (validCode && validCode !== session.roomCode)) {
      const t = setTimeout(() => setLoading(false), 0);
      return () => { clearTimeout(timer); clearTimeout(t); };
    }
    apiFetchState(session.roomCode, session.token)
      .then((s) => {
        setToken(session.token);
        setRoomCode(session.roomCode);
        setState(s);
      })
      .catch(() => {
        clearSession();
      })
      .finally(() => setLoading(false));
    return () => clearTimeout(timer);
  }, []);

  // Поллинг состояния, пока есть активная сессия.
  useEffect(() => {
    if (!token || !roomCode) return;
    let cancelled = false;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      apiFetchState(roomCode, token)
        .then(next => { if (!cancelled) updateState(next); })
        .catch(() => {
          /* временная сетевая ошибка — проигнорируем, попробуем ещё раз */
        });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token, roomCode, updateState]);

  const handleReady = useCallback((newToken: string, newRoomCode: string, newState: StateResponseDTO) => {
    saveSession({ token: newToken, roomCode: newRoomCode });
    setToken(newToken);
    setRoomCode(newRoomCode);
    setState(newState);
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

  return (
    <>
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
