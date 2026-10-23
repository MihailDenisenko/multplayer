// Класс 3D-листка бумаги: рендер текста на CanvasTexture + анимация загиба.
import * as THREE from "three";

export type SheetStyle = "realistic" | "cartoon";

export interface PaperVisibleContent {
  firstAuthorLabel: string | null; // "Листок начал: Имя" (если включена опция)
  keywordLine: string | null; // текущее видимое ключевое слово
  helperLabel: string; // подсказка, что делать сейчас
  draftLines: string[]; // то, что игрок печатает прямо сейчас (до 2 строк)
}

const CANVAS_W = 512;
const CANVAS_H = 680;

export class PaperSheet {
  group = new THREE.Group();
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private bodyMesh: THREE.Mesh;
  private flapGroup: THREE.Group | null = null;
  private stackMesh: THREE.Mesh;
  private style: SheetStyle;
  private foldsDone = 0;
  private width: number;
  private height: number;
  private animating = false;

  constructor(style: SheetStyle = "realistic", width = 0.74, height = 0.98) {
    this.style = style;
    this.width = width;
    this.height = height;
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const geo = new THREE.PlaneGeometry(width, height, 1, 24);
    const mat = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.bodyMesh = new THREE.Mesh(geo, mat);
    this.bodyMesh.castShadow = false;
    this.bodyMesh.receiveShadow = true;
    this.group.add(this.bodyMesh);

    // Стопка загнутой бумаги сверху листа (растёт с каждым загибом).
    const stackGeo = new THREE.BoxGeometry(width, 0.002, 0.05);
    const stackMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.9 });
    this.stackMesh = new THREE.Mesh(stackGeo, stackMat);
    this.stackMesh.visible = false;
    this.stackMesh.position.set(0, height / 2 + 0.001, -height / 2 + 0.02);
    this.group.add(this.stackMesh);

    this.drawContent({
      firstAuthorLabel: null,
      keywordLine: null,
      helperLabel: "",
      draftLines: [],
    });
  }

  setStyle(style: SheetStyle) {
    this.style = style;
  }

  /** Перерисовывает видимую часть листка. */
  drawContent(content: PaperVisibleContent) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Фон бумаги.
    ctx.fillStyle = this.style === "cartoon" ? "#fffdf2" : "#fbfaf4";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Текстура лёгкого шума/бумаги.
    ctx.globalAlpha = this.style === "cartoon" ? 0.04 : 0.06;
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? "#000" : "#888";
      ctx.fillRect(Math.random() * CANVAS_W, Math.random() * CANVAS_H, 1, 1);
    }
    ctx.globalAlpha = 1;

    // Линейка в клетку/линию.
    ctx.strokeStyle = this.style === "cartoon" ? "#bcd9ff" : "#d7e3f0";
    ctx.lineWidth = this.style === "cartoon" ? 3 : 1.5;
    const lineStep = this.style === "cartoon" ? 46 : 38;
    for (let y = 70; y < CANVAS_H - 20; y += lineStep) {
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(CANVAS_W - 24, y);
      ctx.stroke();
    }
    // Левое поле (как в тетради).
    ctx.strokeStyle = this.style === "cartoon" ? "#ff9bb8" : "#e3b8b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(54, 10);
    ctx.lineTo(54, CANVAS_H - 10);
    ctx.stroke();

    let cursorY = 56;

    if (content.firstAuthorLabel) {
      ctx.fillStyle = "#9a9a9a";
      ctx.font = "italic 20px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText(content.firstAuthorLabel, CANVAS_W / 2, cursorY);
      cursorY += 34;
    }

    if (content.keywordLine) {
      ctx.fillStyle = this.style === "cartoon" ? "#e0581f" : "#1f3b57";
      ctx.font = `bold ${this.style === "cartoon" ? 46 : 40}px "Comic Sans MS", "Marker Felt", cursive`;
      ctx.textAlign = "center";
      ctx.fillText(content.keywordLine, CANVAS_W / 2, cursorY + 40);
      cursorY += 100;
    } else {
      cursorY += 20;
    }

    if (content.helperLabel) {
      ctx.fillStyle = "#9fa6ad";
      ctx.font = "italic 22px Georgia, serif";
      ctx.textAlign = "center";
      wrapText(ctx, content.helperLabel, CANVAS_W / 2, cursorY, CANVAS_W - 100, 26);
      cursorY += 56;
    }

    ctx.fillStyle = "#1b2430";
    ctx.font = '30px "Comic Sans MS", "Segoe Script", cursive';
    ctx.textAlign = "left";
    for (const line of content.draftLines) {
      wrapText(ctx, line, 70, cursorY + 30, CANVAS_W - 130, 36);
      cursorY += 72;
    }

    this.texture.needsUpdate = true;
  }

  /** Анимация загиба верхней (только что записанной) части листа. Возвращает Promise. */
  async playFold(snapshotContent: PaperVisibleContent, durationMs = 650): Promise<void> {
    if (this.animating) return;
    this.animating = true;

    // Создаём отдельный canvas-снимок содержимого, которое сейчас "загибается".
    const flapCanvas = document.createElement("canvas");
    flapCanvas.width = CANVAS_W;
    flapCanvas.height = 260;
    const fctx = flapCanvas.getContext("2d")!;
    fctx.fillStyle = this.style === "cartoon" ? "#fffdf2" : "#fbfaf4";
    fctx.fillRect(0, 0, flapCanvas.width, flapCanvas.height);
    fctx.fillStyle = this.style === "cartoon" ? "#e0581f" : "#1f3b57";
    fctx.font = `bold 34px "Comic Sans MS", cursive`;
    fctx.textAlign = "center";
    if (snapshotContent.keywordLine) {
      fctx.fillText(snapshotContent.keywordLine, flapCanvas.width / 2, 60);
    }
    fctx.fillStyle = "#333";
    fctx.font = '26px "Comic Sans MS", cursive';
    let fy = 120;
    for (const line of snapshotContent.draftLines) {
      fctx.fillText(line.slice(0, 40), flapCanvas.width / 2, fy);
      fy += 40;
    }
    const flapTex = new THREE.CanvasTexture(flapCanvas);
    flapTex.colorSpace = THREE.SRGBColorSpace;

    const flapHeight = this.height * 0.34;
    const flapGeo = new THREE.PlaneGeometry(this.width, flapHeight, 1, 10);
    flapGeo.translate(0, flapHeight / 2, 0); // точка опоры — нижний край
    const flapMat = new THREE.MeshStandardMaterial({
      map: flapTex,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    const flapMesh = new THREE.Mesh(flapGeo, flapMat);

    const pivot = new THREE.Group();
    pivot.position.set(0, this.height / 2 - 0.02, 0);
    pivot.add(flapMesh);
    this.group.add(pivot);
    this.flapGroup = pivot;

    await tween(durationMs, (t) => {
      const eased = easeInOutCubic(t);
      pivot.rotation.x = -eased * (Math.PI - 0.12);
      pivot.position.z = -eased * 0.06;
    });

    this.group.remove(pivot);
    flapGeo.dispose();
    flapMat.dispose();
    flapTex.dispose();
    this.flapGroup = null;

    this.foldsDone += 1;
    this.stackMesh.visible = true;
    const h = Math.min(0.11, 0.012 * this.foldsDone);
    this.stackMesh.scale.set(1, h / 0.002, 1);
    this.stackMesh.position.y = this.height / 2 + h / 2;

    this.animating = false;
  }

  /** Анимация "вылета" листка со стола (передача). dir: -1 влево, 1 вправо. */
  async playPassOut(dir: 1 | -1, durationMs = 500): Promise<void> {
    const start = this.group.position.clone();
    const startRot = this.group.rotation.z;
    await tween(durationMs, (t) => {
      const eased = easeInOutCubic(t);
      this.group.position.x = start.x + dir * 1.9 * eased;
      this.group.position.y = start.y + Math.sin(eased * Math.PI) * 0.35;
      this.group.position.z = start.z - eased * 0.5;
      this.group.rotation.z = startRot + dir * 0.6 * eased;
      const mat = this.bodyMesh.material as THREE.MeshStandardMaterial;
      mat.opacity = 1 - eased;
      mat.transparent = true;
    });
    this.group.visible = false;
  }

  /** Анимация "прилёта" нового листка. dir: откуда он прилетает (-1 слева, 1 справа). */
  async playPassIn(dir: 1 | -1, restPosition: THREE.Vector3, durationMs = 500): Promise<void> {
    this.group.visible = true;
    this.foldsDone = 0;
    this.stackMesh.visible = false;
    this.group.position.set(restPosition.x + dir * 1.9, restPosition.y + 0.1, restPosition.z - 0.5);
    this.group.rotation.set(0, 0, -dir * 0.6);
    const mat = this.bodyMesh.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 0;

    await tween(durationMs, (t) => {
      const eased = easeInOutCubic(t);
      this.group.position.x = restPosition.x + dir * 1.9 * (1 - eased);
      this.group.position.y = restPosition.y + Math.sin((1 - eased) * Math.PI) * 0.35;
      this.group.position.z = restPosition.z - 0.5 * (1 - eased);
      this.group.rotation.z = -dir * 0.6 * (1 - eased);
      mat.opacity = eased;
    });
    this.group.position.copy(restPosition);
    this.group.rotation.set(0, 0, 0);
    mat.opacity = 1;
    mat.transparent = false;
  }

  dispose() {
    this.bodyMesh.geometry.dispose();
    (this.bodyMesh.material as THREE.Material).dispose();
    this.texture.dispose();
    this.stackMesh.geometry.dispose();
    (this.stackMesh.material as THREE.Material).dispose();
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function tween(durationMs: number, onUpdate: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    let raf = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      onUpdate(1);
      resolve();
    };
    const handleVisibility = () => {
      if (document.hidden) finish();
    };
    function step(now: number) {
      if (finished) return;
      const t = Math.min(1, (now - start) / durationMs);
      onUpdate(t);
      if (t < 1) raf = requestAnimationFrame(step);
      else finish();
    }

    document.addEventListener("visibilitychange", handleVisibility);
    if (document.hidden) finish();
    else raf = requestAnimationFrame(step);
  });
}
