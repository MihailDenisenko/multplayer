"use client";

// Экран входа: имя игрока, аватарка, создание или подключение к комнате.
import { useRef, useState } from "react";
import { fileToCroppedCircleDataUrl, generatePlaceholderAvatar } from "@/lib/game/avatar";
import { apiCreateRoom, apiJoinRoom } from "@/lib/game/client";
import type { StateResponseDTO } from "@/lib/game/types";
import {
  MAX_FOLDS,
  MAX_PLAYERS,
  MIN_FOLDS,
  MIN_PLAYERS,
  RECOMMENDED_MAX_FOLDS,
} from "@/lib/game/logic";

interface Props {
  initialRoomCode?: string;
  onReady: (token: string, roomCode: string, state: StateResponseDTO) => void;
}

type Mode = "choose" | "create" | "join";

export default function HomeScreen({ onReady, initialRoomCode = "" }: Props) {
  const [mode, setMode] = useState<Mode>(initialRoomCode ? "join" : "choose");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Настройки создаваемой комнаты.
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [folds, setFolds] = useState(12);
  const [direction, setDirection] = useState<"cw" | "ccw">("cw");
  const [style, setStyle] = useState<"realistic" | "cartoon">("realistic");
  const [showFirstAuthor, setShowFirstAuthor] = useState(true);

  const [joinCode, setJoinCode] = useState(initialRoomCode);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToCroppedCircleDataUrl(file);
      setAvatar(dataUrl);
    } catch {
      setError("Не удалось обработать изображение");
    }
  }

  function resolveAvatar(): string {
    return avatar ?? generatePlaceholderAvatar(name || "?");
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError("Введите имя");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiCreateRoom({
        name: name.trim(),
        avatar: resolveAvatar(),
        maxPlayers,
        folds,
        direction,
        style,
        showFirstAuthor,
      });
      onReady(res.token, res.roomCode, res.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания комнаты");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!name.trim()) {
      setError("Введите имя");
      return;
    }
    if (!joinCode.trim()) {
      setError("Введите код комнаты");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiJoinRoom({
        code: joinCode.trim().toUpperCase(),
        name: name.trim(),
        avatar: resolveAvatar(),
      });
      onReady(res.token, res.roomCode, res.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка подключения к комнате");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen-shell flex min-h-screen w-full items-center justify-center bg-[radial-gradient(circle_at_top,#2b2113,40%,#0b0906)] px-3 py-10 text-amber-50 sm:px-4">
      <div className="screen-card w-full max-w-xl rounded-3xl border border-amber-900/40 bg-[#1d160f]/90 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80">3D настольная игра</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-amber-100">📜 Чепуха</h1>
        <p className="mt-2 text-sm text-amber-200/70">
          Складная бумага с вопросами и ответами. Соберите компанию от 4 до 10 человек и получите
          абсурдную историю!
        </p>

        <div className="mt-6 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-amber-500/60 bg-amber-900/30"
            title="Загрузить аватарку"
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl">🙂</span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-[9px] opacity-0 transition group-hover:opacity-100">
              изменить
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <div className="flex-1">
            <label className="text-xs text-amber-300/70">Ваше имя</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Например, Артур"
              className="mt-1 w-full rounded-xl border border-amber-700/50 bg-[#120d08] px-3 py-2 text-amber-50 outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-700/50 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {mode === "choose" && (
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              onClick={() => setMode("create")}
              className="rounded-2xl bg-amber-500 px-5 py-4 text-left font-semibold text-amber-950 shadow-lg transition hover:bg-amber-400"
            >
              🪑 Создать комнату
              <div className="text-xs font-normal text-amber-900/80">Стать ведущим и настроить игру</div>
            </button>
            <button
              onClick={() => setMode("join")}
              className="rounded-2xl border border-amber-500/50 bg-transparent px-5 py-4 text-left font-semibold text-amber-200 transition hover:bg-amber-500/10"
            >
              🔑 Войти в комнату
              <div className="text-xs font-normal text-amber-300/70">Ввести код, который дал ведущий</div>
            </button>
          </div>
        )}

        {mode === "create" && (
          <div className="mt-6 space-y-4">
            <SettingRow label={`Количество игроков: ${maxPlayers}`}>
              <input
                type="range"
                min={MIN_PLAYERS}
                max={MAX_PLAYERS}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                className="w-full"
              />
            </SettingRow>
            <SettingRow label={`Загибов на каждом листке: ${folds}`}>
              <input
                type="range"
                min={MIN_FOLDS}
                max={MAX_FOLDS}
                value={folds}
                onChange={(e) => setFolds(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-xs text-amber-200/70">Одна отправка — один загиб этого листка. Игра закончится, когда на каждом листке будет по {folds} загибов.</p>
              {folds > RECOMMENDED_MAX_FOLDS && (
                <p className="mt-1 text-xs text-amber-400">
                  Чем больше загибов, тем длиннее партия. Рекомендуем 10–15 для первой игры.
                </p>
              )}
            </SettingRow>
            <SettingRow label="Направление передачи">
              <div className="flex gap-2">
                <PillButton active={direction === "cw"} onClick={() => setDirection("cw")}>
                  ↻ По часовой
                </PillButton>
                <PillButton active={direction === "ccw"} onClick={() => setDirection("ccw")}>
                  ↺ Против часовой
                </PillButton>
              </div>
            </SettingRow>
            <SettingRow label="Визуальный стиль">
              <div className="flex gap-2">
                <PillButton active={style === "realistic"} onClick={() => setStyle("realistic")}>
                  🪵 Реалистичный
                </PillButton>
                <PillButton active={style === "cartoon"} onClick={() => setStyle("cartoon")}>
                  🎨 Мультяшный
                </PillButton>
              </div>
            </SettingRow>
            <label className="flex items-center gap-2 text-sm text-amber-200/80">
              <input
                type="checkbox"
                checked={showFirstAuthor}
                onChange={(e) => setShowFirstAuthor(e.target.checked)}
              />
              Показывать имя автора, начавшего листок
            </label>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setMode("choose")}
                className="rounded-xl border border-amber-700/50 px-4 py-2 text-sm text-amber-200"
              >
                Назад
              </button>
              <button
                onClick={handleCreate}
                disabled={busy}
                className="flex-1 rounded-xl bg-amber-500 px-4 py-2 font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-50"
              >
                {busy ? "Создаём…" : "Создать комнату"}
              </button>
            </div>
          </div>
        )}

        {mode === "join" && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="text-xs text-amber-300/70">Код комнаты</label>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={8}
                placeholder="например, A3F9K2"
                className="mt-1 w-full rounded-xl border border-amber-700/50 bg-[#120d08] px-3 py-2 uppercase tracking-[0.3em] text-amber-50 outline-none focus:border-amber-400"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setMode("choose")}
                className="rounded-xl border border-amber-700/50 px-4 py-2 text-sm text-amber-200"
              >
                Назад
              </button>
              <button
                onClick={handleJoin}
                disabled={busy}
                className="flex-1 rounded-xl bg-amber-500 px-4 py-2 font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-50"
              >
                {busy ? "Подключаемся…" : "Войти в комнату"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-amber-300/70">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border px-3 py-2 text-sm transition ${
        active
          ? "border-amber-400 bg-amber-500/20 text-amber-100"
          : "border-amber-800/50 text-amber-300/70 hover:bg-amber-900/30"
      }`}
    >
      {children}
    </button>
  );
}
