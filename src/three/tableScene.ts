// Стол, окружение и карточки игроков (аватар + имя + статус) для сцены "Чепухи".
import * as THREE from "three";
import type { PlayerActivity } from "@/lib/game/types";

export type SceneStyle = "realistic" | "cartoon";

export const TABLE_CENTER = new THREE.Vector3(0, 0.74, -1.55);
export const TABLE_RADIUS = 1.35;

export function createTable(style: SceneStyle): THREE.Group {
  const group = new THREE.Group();

  const topGeo = new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.08, 48);
  const topMat =
    style === "realistic"
      ? new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.55, metalness: 0.05 })
      : new THREE.MeshToonMaterial({ color: 0xffb259 });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.copy(TABLE_CENTER);
  top.receiveShadow = true;
  top.castShadow = true;
  group.add(top);

  const legGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.7, 16);
  const legMat =
    style === "realistic"
      ? new THREE.MeshStandardMaterial({ color: 0x4b3321, roughness: 0.6 })
      : new THREE.MeshToonMaterial({ color: 0xe08a3c });
  const leg = new THREE.Mesh(legGeo, legMat);
  leg.position.set(TABLE_CENTER.x, TABLE_CENTER.y - 0.42 - 0.04, TABLE_CENTER.z);
  leg.castShadow = true;
  group.add(leg);

  // Скатерть-круг чуть шире столешницы, добавляет уюта.
  const clothGeo = new THREE.CircleGeometry(TABLE_RADIUS + 0.04, 48);
  const clothMat =
    style === "realistic"
      ? new THREE.MeshStandardMaterial({ color: 0x8a1f2b, roughness: 0.85, side: THREE.DoubleSide })
      : new THREE.MeshToonMaterial({ color: 0x3fb6ff, side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.set(TABLE_CENTER.x, TABLE_CENTER.y + 0.041, TABLE_CENTER.z);
  cloth.visible = style === "cartoon"; // яркая скатерть только в мультяшном стиле
  group.add(cloth);

  return group;
}

export function setupEnvironment(scene: THREE.Scene, style: SceneStyle) {
  if (style === "realistic") {
    scene.background = new THREE.Color(0x1b1510);
    scene.fog = new THREE.Fog(0x1b1510, 4, 11);
  } else {
    scene.background = new THREE.Color(0x8fd8ff);
    scene.fog = new THREE.Fog(0x8fd8ff, 5, 13);
  }

  // Пол.
  const floorGeo = new THREE.PlaneGeometry(30, 30);
  const floorMat =
    style === "realistic"
      ? new THREE.MeshStandardMaterial({ color: 0x2b2117, roughness: 0.9 })
      : new THREE.MeshToonMaterial({ color: 0x5fd17a });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  floor.name = "floor";
  scene.add(floor);
}

export function setupLights(scene: THREE.Scene, style: SceneStyle): THREE.Light[] {
  const lights: THREE.Light[] = [];
  if (style === "realistic") {
    const ambient = new THREE.AmbientLight(0xfff1dd, 0.55);
    const dir = new THREE.DirectionalLight(0xffe0b0, 1.1);
    dir.position.set(2, 4, 2);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 10;
    const lamp = new THREE.PointLight(0xffcf8c, 0.6, 8);
    lamp.position.set(0, 2.6, -1.5);
    scene.add(ambient, dir, lamp);
    lights.push(ambient, dir, lamp);
  } else {
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 5, 3);
    const rim = new THREE.DirectionalLight(0xff9bd1, 0.4);
    rim.position.set(-3, 2, -2);
    scene.add(ambient, dir, rim);
    lights.push(ambient, dir, rim);
  }
  return lights;
}

/** Вычисляет позиции для "других" игроков (не включая себя) по дуге вокруг стола. */
export function computeSeatPositions(count: number): THREE.Vector3[] {
  if (count <= 0) return [];
  const startAngle = -Math.PI * 0.62;
  const endAngle = Math.PI * 0.62;
  const positions: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = startAngle + (endAngle - startAngle) * t;
    const x = TABLE_CENTER.x + Math.sin(angle) * TABLE_RADIUS * 1.05;
    const z = TABLE_CENTER.z - Math.cos(angle) * TABLE_RADIUS * 1.05;
    positions.push(new THREE.Vector3(x, TABLE_CENTER.y + 0.62, z));
  }
  return positions;
}

const ACTIVITY_LABEL: Record<PlayerActivity, string> = {
  writing: "Пишет…",
  waiting: "Ожидает",
  done: "Готово ✓",
  offline: "Не в сети",
};
const ACTIVITY_COLOR: Record<PlayerActivity, string> = {
  writing: "#ffb020",
  waiting: "#8fa0b5",
  done: "#3ac16b",
  offline: "#c44848",
};

/** Карточка игрока над столом: круглая аватарка + имя + статус. */
export class SeatCard {
  sprite: THREE.Sprite;
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private avatarImg: HTMLImageElement | null = null;
  private lastAvatar: string | null = null;

  constructor() {
    this.canvas.width = 256;
    this.canvas.height = 320;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.texture, transparent: true });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(0.62, 0.78, 1);
  }

  update(info: { name: string; avatar: string | null; activity: PlayerActivity; isHost: boolean }) {
    if (info.avatar && info.avatar !== this.lastAvatar) {
      this.lastAvatar = info.avatar;
      const img = new Image();
      img.onload = () => {
        this.avatarImg = img;
        this.redraw(info);
      };
      img.src = info.avatar;
    }
    this.redraw(info);
  }

  private redraw(info: { name: string; avatar: string | null; activity: PlayerActivity; isHost: boolean }) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    ctx.clearRect(0, 0, w, this.canvas.height);

    // Рамка-подставка.
    ctx.fillStyle = "rgba(20,14,8,0.55)";
    roundRect(ctx, 8, 150, w - 16, 150, 18);
    ctx.fill();

    // Аватар.
    const cx = w / 2;
    const cy = 100;
    const r = 86;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "#cccccc";
    ctx.fill();
    ctx.clip();
    if (this.avatarImg) {
      ctx.drawImage(this.avatarImg, cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.lineWidth = 6;
    ctx.strokeStyle = info.isHost ? "#ffd166" : "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Имя.
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px Arial";
    ctx.textAlign = "center";
    ctx.fillText(info.name.slice(0, 16), cx, 210);

    // Статус.
    ctx.fillStyle = ACTIVITY_COLOR[info.activity];
    ctx.beginPath();
    ctx.arc(cx - 70, 250, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8e8e8";
    ctx.font = "24px Arial";
    ctx.fillText(ACTIVITY_LABEL[info.activity], cx + 12, 258);

    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
