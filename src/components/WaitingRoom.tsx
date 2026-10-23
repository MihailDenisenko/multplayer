"use client";

// Зал ожидания: список подключившихся игроков, код комнаты, кнопка "Начать игру" для ведущего.
import { useState } from "react";
import type { StateResponseDTO } from "@/lib/game/types";
import { apiStartGame } from "@/lib/game/client";

interface Props {
  state: StateResponseDTO;
  token: string;
  appUrl: string;
  onError: (msg: string) => void;
  onLeave: () => void;
}

const DIRECTION_LABEL: Record<string, string> = { cw: "по часовой стрелке", ccw: "против часовой стрелки" };
const STYLE_LABEL: Record<string, string> = { realistic: "Реалистичный", cartoon: "Мультяшный" };

export default function WaitingRoom({ state, token, appUrl, onError, onLeave }: Props) {
  const [starting, setStarting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState("");
  const invitationUrl = appUrl ? new URL(`/?room=${encodeURIComponent(state.room.code)}`, appUrl).href : "";
  const me = state.players.find((p) => p.isMe);
  const canStart = state.players.length >= 3 && state.players.length <= state.room.maxPlayers;

  async function handleStart() {
    setStarting(true);
    try {
      await apiStartGame(state.room.code, token);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не удалось начать игру");
    } finally {
      setStarting(false);
    }
  }

  function copyCode() {
    navigator.clipboard?.writeText(state.room.code).catch(() => {});
  }

  async function copyInvitation() {
    if (!invitationUrl) return;
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setCopiedUrl(invitationUrl);
    } catch {
      onError("Не удалось скопировать ссылку. Выделите её в поле и скопируйте вручную.");
    }
  }

  return (
    <div className="screen-shell flex min-h-screen w-full items-center justify-center bg-[radial-gradient(circle_at_top,#182a1f,40%,#070a08)] px-3 py-10 text-emerald-50 sm:px-4">
      <div className="screen-card w-full max-w-2xl rounded-3xl border border-emerald-900/40 bg-[#101b14]/90 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-400/80">Зал ожидания</p>
            <h1 className="mt-1 text-3xl font-black">📜 Чепуха</h1>
          </div>
          <button
            onClick={copyCode}
            className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 font-mono text-xl tracking-[0.35em] text-emerald-200 hover:bg-emerald-500/20"
            title="Нажмите, чтобы скопировать код"
          >
            {state.room.code}
          </button>
        </div>

        <div className="mt-5">
          <label htmlFor="invitation-url" className="text-sm text-emerald-200">Ссылка для приглашения</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input id="invitation-url" readOnly value={invitationUrl} placeholder="Соединение восстанавливается…" onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-xl border border-emerald-700/50 bg-emerald-950/50 px-3 py-2 text-sm" />
            <button onClick={copyInvitation} disabled={!invitationUrl}
              className="rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-emerald-950 disabled:opacity-50">
              {copiedUrl && copiedUrl === invitationUrl ? "Ссылка скопирована" : "Скопировать ссылку"}
            </button>
          </div>
          <p className="mt-2 text-xs text-emerald-300/70" role="status">{invitationUrl ? "Другу останется ввести имя и нажать «Войти в комнату». Если адрес изменился, отправьте новую ссылку." : "Ссылка временно недоступна. Соединение восстанавливается автоматически."}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-emerald-300/70 sm:grid-cols-4">
          <InfoChip label="Игроков" value={`${state.players.length}/${state.room.maxPlayers}`} />
          <InfoChip label="Загибов на листке" value={String(state.room.folds)} />
          <InfoChip label="Направление" value={DIRECTION_LABEL[state.room.direction]} />
          <InfoChip label="Стиль" value={STYLE_LABEL[state.room.style]} />
        </div>

        <h2 className="mt-6 text-sm uppercase tracking-wide text-emerald-400/70">Игроки за столом</h2>
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {state.players.map((p) => (
            <li
              key={p.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                p.isMe ? "border-emerald-400/70 bg-emerald-500/10" : "border-emerald-900/50 bg-emerald-950/30"
              }`}
            >
              <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-emerald-900">
                {p.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar} alt="" className="h-full w-full object-cover" />
                ) : null}
              </span>
              <span className="truncate text-sm">
                {p.name} {p.isHost && <span title="Ведущий">👑</span>}
              </span>
            </li>
          ))}
          {Array.from({ length: Math.max(0, state.room.maxPlayers - state.players.length) }).map((_, i) => (
            <li
              key={`empty-${i}`}
              className="flex items-center gap-2 rounded-xl border border-dashed border-emerald-900/40 px-3 py-2 text-emerald-700/50"
            >
              <span className="h-9 w-9 rounded-full border border-dashed border-emerald-800/50" />
              <span className="text-sm">свободно…</span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-sm text-emerald-300/70">
          Поделитесь ссылкой или кодом комнаты <b className="text-emerald-200">{state.room.code}</b> с друзьями. Для
          начала игры нужно минимум 3 игрока.
        </p>

        {me?.isHost ? (
          <button
            onClick={handleStart}
            disabled={!canStart || starting}
            className="mt-6 w-full rounded-xl bg-emerald-500 px-5 py-3 text-lg font-bold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Запускаем…" : canStart ? "▶️ Начать игру" : "Ожидаем игроков…"}
          </button>
        ) : (
          <div className="mt-6 rounded-xl border border-emerald-900/50 bg-emerald-950/40 px-4 py-3 text-center text-emerald-300/80">
            Ожидаем, пока ведущий начнёт игру…
          </div>
        )}
        {me?.isHost && (
          <button onClick={onLeave} disabled={starting}
            className="mt-3 min-h-12 w-full rounded-xl border border-emerald-700/60 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/10 disabled:opacity-50">
            ← В главное меню
          </button>
        )}
      </div>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-emerald-500/70">{label}</div>
      <div className="text-emerald-100">{value}</div>
    </div>
  );
}
