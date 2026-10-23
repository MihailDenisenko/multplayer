"use client";

// Главный игровой экран: 3D-сцена (Three.js) + HTML-оверлей с полем ввода.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SceneManager } from "@/three/sceneManager";
import type { PaperVisibleContent } from "@/three/paperSheet";
import { apiSubmit } from "@/lib/game/client";
import type { MySheetDTO, StateResponseDTO } from "@/lib/game/types";
import { soundManager } from "@/three/soundManager";

interface Props {
  state: StateResponseDTO;
  token: string;
  onError: (msg: string) => void;
  onState: (state: StateResponseDTO) => void;
}

type Step = "answer" | "question" | "keyword";

function stepsForStage(stage: MySheetDTO["stage"]): Step[] {
  if (stage === "question_only") return ["question", "keyword"];
  if (stage === "final_answer") return ["answer"];
  return ["answer", "question", "keyword"];
}

const STEP_LABEL: Record<Step, string> = {
  answer: "Ответьте на вопрос",
  question: "Напишите свой вопрос",
  keyword: "Напишите ключевое слово (его увидит следующий игрок)",
};

const STEP_PLACEHOLDER: Record<Step, string> = {
  answer: "Ваш ответ…",
  question: "Например: Почему Артур сегодня не пришёл?",
  keyword: "Например: Почему?",
};

export default function GameScreen({ state, token, onError, onState }: Props) {
  const screenRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);

  const [phase, setPhase] = useState<"form" | "animating" | "waiting">("waiting");
  const [localSheetId, setLocalSheetId] = useState<number | null>(null);
  const [stage, setStage] = useState<MySheetDTO["stage"] | null>(null);
  const [keyword, setKeyword] = useState<string | null>(null);
  const [firstAuthorLabel, setFirstAuthorLabel] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [answerText, setAnswerText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [keywordText, setKeywordText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [muted, setMuted] = useState(false);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirOut: 1 | -1 = state.room.direction === "cw" ? 1 : -1;
  const dirIn: 1 | -1 = dirOut === 1 ? -1 : 1;

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => screenRef.current?.style.setProperty("--game-height", `${viewport?.height ?? window.innerHeight}px`);
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  // ───────────── Инициализация 3D-сцены ─────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new SceneManager(containerRef.current, state.room.style);
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setStyle(state.room.style);
  }, [state.room.style]);

  useEffect(() => {
    sceneRef.current?.updatePlayers(state.players);
  }, [state.players]);

  useEffect(() => {
    sceneRef.current?.setQueuedSheetCount(state.queuedCount, dirIn);
  }, [state.queuedCount, dirIn]);

  const steps = useMemo(() => (stage ? stepsForStage(stage) : []), [stage]);
  const currentStep = steps[stepIndex];

  const buildDraftContent = useCallback(
    (overrideStep?: Step): PaperVisibleContent => {
      const lines: string[] = [];
      const upto = overrideStep ? steps.indexOf(overrideStep) : stepIndex;
      if (steps.includes("answer") && upto >= steps.indexOf("answer")) {
        lines.push(`Ответ: ${answerText}`);
      }
      if (steps.includes("question") && upto >= steps.indexOf("question")) {
        lines.push(`Вопрос: ${questionText}`);
      }
      return {
        firstAuthorLabel,
        keywordLine: stage === "question_only" ? null : keyword,
        helperLabel: currentStep ? STEP_LABEL[currentStep] : "",
        draftLines: lines,
      };
    },
    [answerText, questionText, firstAuthorLabel, keyword, stage, stepIndex, steps, currentStep],
  );

  // Перерисовываем текстуру листа при изменении текста/шага.
  useEffect(() => {
    if (phase !== "form" || !sceneRef.current) return;
    sceneRef.current.updateMySheetContent(buildDraftContent());
  }, [phase, buildDraftContent]);

  function resetFormFor(sheet: MySheetDTO) {
    setStage(sheet.stage);
    setKeyword(sheet.keyword);
    setFirstAuthorLabel(sheet.firstAuthorName);
    setStepIndex(0);
    setAnswerText("");
    setQuestionText("");
    setKeywordText("");
  }

  // ───────────── Синхронизация с состоянием сервера (поллинг) ─────────────
  useEffect(() => {
    if (phase === "animating") return; // не вмешиваемся, пока идёт анимация
    const synchronize = () => {
    const sheet = state.mySheet;

    if (sheet) {
      if (localSheetId === null) {
        // Самый первый листок при старте игры — показываем сразу, без анимации прилёта.
        setLocalSheetId(sheet.sheetId);
        resetFormFor(sheet);
        setPhase("form");
        if (sceneRef.current) {
          sceneRef.current.updateMySheetContent({
            firstAuthorLabel: sheet.firstAuthorName,
            keywordLine: sheet.stage === "question_only" ? null : sheet.keyword,
            helperLabel: STEP_LABEL[stepsForStage(sheet.stage)[0]],
            draftLines: [],
          });
        }
      } else if (sheet.sheetId === localSheetId && phase === "form" && stage !== sheet.stage) {
        // Синхронизируем стадию текущего листка с сервером.
        setStage(sheet.stage);
        setStepIndex(0);
      } else if (sheet.sheetId === localSheetId && phase === "waiting") {
        // Восстанавливаем форму, если локальная анимация была прервана фоновой вкладкой.
        resetFormFor(sheet);
        setPhase("form");
      } else if (sheet.sheetId !== localSheetId) {
        // Сервер уже передал старый лист: принимаем новый даже после потерянного submit-ответа.
        setPhase("animating");
        const scene = sceneRef.current;
        const run = async () => {
          if (scene) {
            scene.updateMySheetContent({
              firstAuthorLabel: sheet.firstAuthorName,
              keywordLine: sheet.stage === "question_only" ? null : sheet.keyword,
              helperLabel: STEP_LABEL[stepsForStage(sheet.stage)[0]],
              draftLines: [],
            });
            await scene.playPassInAnimation(dirIn);
          }
          setLocalSheetId(sheet.sheetId);
          resetFormFor(sheet);
          setPhase("form");
        };
        run();
      }
    } else if (phase !== "waiting") {
      setLocalSheetId(null);
      setPhase("waiting");
    }
    };
    const timer = setTimeout(synchronize, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mySheet, phase, localSheetId, stage, dirIn]);

  function notifyTyping() {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setHandState("writing");
    if (Math.random() < 0.35) scene.pencilTick();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => scene.setHandState("idle"), 700);
  }

  useEffect(() => {
    soundManager.setMuted(muted);
  }, [muted]);

  async function handleNext() {
    if (!currentStep || !stage || localSheetId === null) return;
    const value =
      currentStep === "answer" ? answerText : currentStep === "question" ? questionText : keywordText;
    if (!value.trim()) {
      onError("Заполните поле перед тем, как продолжить");
      return;
    }

    const isLastStep = stepIndex === steps.length - 1;
    if (!isLastStep) {
      soundManager.confirm();
      setStepIndex((i) => i + 1);
      return;
    }

    // Последний шаг стадии — отправляем весь набор данных и запускаем анимацию загиба/передачи.
    setSubmitting(true);
    setPhase("animating");
    const scene = sceneRef.current;
    try {
      const snapshotLines: string[] = [];
      if (keyword) snapshotLines.push(`[${keyword}]`);
      if (steps.includes("answer")) snapshotLines.push(`Ответ: ${answerText}`);
      if (steps.includes("question")) snapshotLines.push(`Вопрос: ${questionText}`);

      const payload = {
        sheetId: localSheetId,
        answerText: steps.includes("answer") ? answerText : undefined,
        questionText: steps.includes("question") ? questionText : undefined,
        keyword: steps.includes("keyword") ? keywordText : undefined,
      };

      // Отправка не должна ждать requestAnimationFrame: браузеры приостанавливают
      // анимации фоновых вкладок, из-за чего листок раньше мог не уйти на сервер.
      const submitPromise = apiSubmit(state.room.code, token, payload);
      const animationPromise = scene
        ? (async () => {
            await scene.playFoldAnimation({
              firstAuthorLabel,
              keywordLine: null,
              helperLabel: "",
              draftLines: snapshotLines,
            });
            if (stage !== "final_answer") {
              scene.updateMySheetContent({
                firstAuthorLabel: null,
                keywordLine: keywordText,
                helperLabel: "Передаём листок соседу…",
                draftLines: [],
              });
            }
            await scene.playPassOutAnimation(dirOut);
          })()
        : Promise.resolve();

      const [resp] = await Promise.all([submitPromise, animationPromise]);

      onState(resp.state);
      if (resp.state.finished) return;

      const nextSheet = resp.state.mySheet;
      if (nextSheet && nextSheet.sheetId !== localSheetId) {
        if (scene) {
          scene.updateMySheetContent({
            firstAuthorLabel: nextSheet.firstAuthorName,
            keywordLine: nextSheet.stage === "question_only" ? null : nextSheet.keyword,
            helperLabel: STEP_LABEL[stepsForStage(nextSheet.stage)[0]],
            draftLines: [],
          });
          await scene.playPassInAnimation(dirIn);
        }
        setLocalSheetId(nextSheet.sheetId);
        resetFormFor(nextSheet);
        setPhase("form");
      } else {
        setLocalSheetId(null);
        setPhase("waiting");
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не удалось отправить данные");
      // Ответ мог потеряться уже после commit на сервере. Polling определит,
      // остался ли старый лист у игрока, и безопасно восстановит нужную форму.
      setPhase("waiting");
    } finally {
      setSubmitting(false);
    }
  }

  const waitingName = state.waitingForName;
  const waitingPlayerOffline = state.players.some((player) => player.name === waitingName && player.activity === "offline");
  const foldsLabel = state.mySheet ? `${state.mySheet.foldsDone} / ${state.room.folds}` : "ожидание листка";

  return (
    <div ref={screenRef} className="game-screen relative w-full overflow-hidden bg-black text-white">
      <div ref={containerRef} className="game-scene absolute inset-0" />

      {/* Верхняя панель */}
      <div className="game-header pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 sm:p-4">
        <div className="game-room-info pointer-events-auto rounded-xl bg-black/50 px-3 py-2 text-xs backdrop-blur">
          <div className="font-mono tracking-[0.25em] text-amber-300">{state.room.code}</div>
          <div className="mt-1 text-slate-300" aria-live="polite">Загибы листка: {foldsLabel}</div>
          <div className="mt-1 text-emerald-300">Готово листков: {state.sheetsProgress.finished} / {state.sheetsProgress.total}</div>
        </div>
        <div className="game-players pointer-events-auto flex flex-wrap justify-end gap-1 rounded-xl bg-black/50 p-2 backdrop-blur">
          {state.players.map((p) => (
            <div
              key={p.id}
              title={p.name}
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${
                p.activity === "writing"
                  ? "bg-amber-500/30 text-amber-200"
                  : p.activity === "done"
                    ? "bg-emerald-500/30 text-emerald-200"
                    : p.activity === "offline"
                      ? "bg-red-500/20 text-red-200"
                      : "bg-slate-500/20 text-slate-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  p.activity === "writing"
                    ? "animate-pulse bg-amber-400"
                    : p.activity === "done"
                      ? "bg-emerald-400"
                      : p.activity === "offline"
                        ? "bg-red-400"
                        : "bg-slate-400"
                }`}
              />
              {p.name.slice(0, 10)}
            </div>
          ))}
          <button
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Включить звук" : "Выключить звук"}
            className="rounded-full bg-slate-700/50 px-2 py-1 text-[10px]"
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>

      {/* Нижняя панель ввода */}
      <div className="game-controls pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 sm:p-6">
        <div className="game-form pointer-events-auto w-full max-w-xl rounded-2xl border border-amber-900/40 bg-[#1b140c]/90 p-4 shadow-2xl backdrop-blur">
          {phase === "waiting" && (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500/30 border-t-amber-400" />
              <p className="text-amber-200">
                {waitingPlayerOffline && waitingName
                  ? `Соединение с ${waitingName} потеряно. Игра продолжится после подключения…`
                  : waitingName
                    ? `Ожидание листка от ${waitingName}…`
                    : "Ожидание листка…"}
              </p>
              {state.queuedCount > 0 && (
                <p className="text-xs text-amber-500/70">В очереди у вас ещё {state.queuedCount} лист(ов)</p>
              )}
            </div>
          )}

          {phase === "animating" && (
            <div className="flex items-center justify-center gap-2 py-6 text-amber-200">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
              Загибаем и передаём листок…
            </div>
          )}

          {phase === "form" && currentStep && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-400/70">
                <span>
                  Шаг {stepIndex + 1} из {steps.length}
                </span>
                {keyword && stage !== "question_only" && (
                  <span>
                    Ключевое слово: <b className="text-amber-200">{keyword}</b>
                  </span>
                )}
                {state.queuedCount > 0 && (
                  <span className="text-sky-300">Рядом ждёт листок: {state.queuedCount}</span>
                )}
              </div>
              <label htmlFor="game-answer" className="mb-2 block text-sm font-semibold text-amber-100">{STEP_LABEL[currentStep]}</label>
              <textarea
                id="game-answer"
                rows={2}
                maxLength={currentStep === "keyword" ? 60 : 300}
                value={
                  currentStep === "answer" ? answerText : currentStep === "question" ? questionText : keywordText
                }
                onChange={(e) => {
                  notifyTyping();
                  const v = e.target.value;
                  if (currentStep === "answer") setAnswerText(v);
                  else if (currentStep === "question") setQuestionText(v);
                  else setKeywordText(v);
                }}
                placeholder={STEP_PLACEHOLDER[currentStep]}
                className="w-full resize-none rounded-xl border border-amber-800/50 bg-[#120d08] px-3 py-2 text-amber-50 outline-none focus:border-amber-400"
              />
              <button
                onClick={handleNext}
                disabled={submitting}
                className="mt-3 w-full rounded-xl bg-amber-500 px-4 py-2.5 font-bold text-amber-950 transition hover:bg-amber-400 disabled:opacity-50"
              >
                {stepIndex === steps.length - 1
                  ? stage === "final_answer"
                    ? "✅ Готово"
                    : "🤲 Загнуть и передать"
                  : "Далее →"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
