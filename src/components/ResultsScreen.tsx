"use client";

// Финальный экран: разворачивание листков и чтение получившихся абсурдных диалогов.
import { useEffect, useState } from "react";
import { apiFetchResults } from "@/lib/game/client";
import type { StateResponseDTO } from "@/lib/game/types";
import { soundManager } from "@/three/soundManager";

interface ResultSheet {
  sheetId: number;
  originAuthorName: string;
  entries: { type: "question" | "answer"; text: string; keyword: string | null; authorName: string }[];
}

interface Props {
  state: StateResponseDTO;
  token: string;
  onLeave: () => void;
}

export default function ResultsScreen({ state, token, onLeave }: Props) {
  const [sheets, setSheets] = useState<ResultSheet[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetchResults(state.room.code, token)
      .then((res) => {
        if (cancelled) return;
        setSheets(res.sheets);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить результаты"));
    return () => {
      cancelled = true;
    };
  }, [state.room.code, token]);

  useEffect(() => {
    if (!sheets) return;
    const hide = setTimeout(() => setRevealed(false), 0);
    soundManager.unfold();
    const show = setTimeout(() => setRevealed(true), 80);
    return () => {
      clearTimeout(hide);
      clearTimeout(show);
    };
  }, [sheets, index]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-red-300">
        {error}
      </div>
    );
  }

  if (!sheets) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-amber-200">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500/30 border-t-amber-400" />
        Собираем листки со всего стола…
      </div>
    );
  }

  const sheet = sheets[index];

  return (
    <div className="screen-shell flex min-h-screen flex-col items-center bg-[radial-gradient(circle_at_top,#2a1f12,45%,#070503)] px-3 py-8 text-amber-50 sm:px-4">
      <h1 className="text-3xl font-black">🎉 Результаты</h1>
      <p className="mt-1 text-sm text-amber-300/70">
        Листок {index + 1} из {sheets.length}
      </p>

      <div
        className="results-paper mt-6 w-full max-w-xl origin-top rounded-xl border border-amber-900/50 bg-[#fdf8ec] p-6 text-[#2a2117] shadow-[0_20px_60px_rgba(0,0,0,0.5)] transition-transform duration-500"
        style={{
          transform: revealed ? "scaleY(1)" : "scaleY(0.05)",
          backgroundImage:
            "repeating-linear-gradient(#fdf8ec 0 36px, #e3dcc8 37px, #fdf8ec 38px)",
        }}
      >
        {state.room.showFirstAuthor && (
          <p className="mb-3 text-center text-xs italic text-[#8a7f66]">
            Листок начал: {sheet.originAuthorName}
          </p>
        )}
        <div className="space-y-3 font-serif">
          {sheet.entries.map((e, i) => (
            <div key={i}>
              <p className={e.type === "question" ? "font-semibold text-[#5a3b1e]" : "text-[#2a2117]"}>
                {e.type === "question" ? "❓ " : "💬 "}
                {e.text}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-[#a39878]">— {e.authorName}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="results-navigation mt-6 flex items-center gap-3">
        <button
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="rounded-xl border border-amber-700/50 px-4 py-2 disabled:opacity-30"
        >
          ← Предыдущий
        </button>
        <button
          disabled={index === sheets.length - 1}
          onClick={() => setIndex((i) => Math.min(sheets.length - 1, i + 1))}
          className="rounded-xl border border-amber-700/50 px-4 py-2 disabled:opacity-30"
        >
          Следующий →
        </button>
      </div>

      <button
        onClick={onLeave}
        className="mt-8 rounded-xl bg-amber-500 px-6 py-3 font-bold text-amber-950 hover:bg-amber-400"
      >
        🔁 Новая игра
      </button>
    </div>
  );
}
