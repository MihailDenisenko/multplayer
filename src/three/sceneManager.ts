// Оркестратор 3D-сцены: рендерер, камера, стол, карточки игроков, "моя" бумага и руки.
import * as THREE from "three";
import { PaperSheet, type PaperVisibleContent, type SheetStyle } from "./paperSheet";
import { HandAnimator, type HandState } from "./handAnimator";
import { SeatCard, TABLE_CENTER, computeSeatPositions, createTable, setupEnvironment, setupLights } from "./tableScene";
import type { PlayerPublicDTO } from "@/lib/game/types";
import { soundManager } from "./soundManager";

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private tableGroup: THREE.Group;
  private lights: THREE.Light[] = [];
  private seatCards = new Map<number, SeatCard>();
  private paper: PaperSheet;
  private hands: HandAnimator;
  private style: SheetStyle;
  private clock = new THREE.Clock();
  private raf = 0;
  private mouseTarget = new THREE.Vector2(0, 0);
  private mouseCurrent = new THREE.Vector2(0, 0);
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private paperRest = new THREE.Vector3(0, -0.56, -0.92);

  constructor(container: HTMLElement, style: SheetStyle = "realistic") {
    this.container = container;
    this.style = style;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 50);
    this.camera.position.set(0, 1.55, 1.35);
    this.camera.lookAt(TABLE_CENTER.x, TABLE_CENTER.y + 0.2, TABLE_CENTER.z);
    this.scene.add(this.camera);

    setupEnvironment(this.scene, style);
    this.lights = setupLights(this.scene, style);
    this.tableGroup = createTable(style);
    this.scene.add(this.tableGroup);

    // Бумага и руки "приклеены" к камере — первый вид от игрока.
    this.paper = new PaperSheet(style);
    this.paper.group.position.set(0, -0.56, -0.92);
    this.paper.group.rotation.x = -0.42;
    this.camera.add(this.paper.group);

    this.hands = new HandAnimator(style);
    this.hands.group.position.set(0, -0.62, -0.55);
    this.camera.add(this.hands.group);

    this.resize();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    window.addEventListener("resize", this.resize);
    container.addEventListener("pointermove", this.onPointerMove);

    this.animate();
  }

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.container.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    this.mouseTarget.set(nx, ny);
  };

  private resize = () => {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    const mobile = window.matchMedia("(max-width: 639px), (max-height: 500px) and (pointer: coarse)").matches;
    this.paperRest.set(0, mobile ? -0.08 : -0.56, -0.92);
    this.paper.group.position.copy(this.paperRest);
    this.paper.group.scale.setScalar(mobile ? Math.min(0.72, (w / h) * 0.9) : 1);
    this.hands.group.scale.setScalar(mobile ? 0.7 : 1);
    this.camera.updateProjectionMatrix();
  };

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(0.1, this.clock.getDelta());

    this.mouseCurrent.lerp(this.mouseTarget, 0.04);
    const baseYaw = 0;
    const baseLook = new THREE.Vector3(TABLE_CENTER.x, TABLE_CENTER.y + 0.2, TABLE_CENTER.z);
    const yaw = baseYaw - this.mouseCurrent.x * 0.35;
    const pitch = 0.1 - this.mouseCurrent.y * 0.18;
    const lookTarget = baseLook.clone();
    lookTarget.x += Math.sin(yaw) * 0.9;
    lookTarget.y += pitch;
    this.camera.lookAt(lookTarget);

    this.hands.update(dt);

    for (const card of this.seatCards.values()) {
      card.sprite.quaternion.copy(this.camera.quaternion);
    }

    this.renderer.render(this.scene, this.camera);
  };

  setStyle(style: SheetStyle) {
    if (this.style === style) return;
    this.style = style;
    setupEnvironment(this.scene, style);
    this.lights.forEach((l) => this.scene.remove(l));
    this.lights = setupLights(this.scene, style);
    this.scene.remove(this.tableGroup);
    this.tableGroup = createTable(style);
    this.scene.add(this.tableGroup);
    this.paper.setStyle(style);
    this.hands.setStyle(style);
  }

  /** Обновляет карточки других игроков вокруг стола. */
  updatePlayers(players: PlayerPublicDTO[]) {
    const others = players.filter((p) => !p.isMe);
    const positions = computeSeatPositions(others.length);

    const seenIds = new Set<number>();
    others.forEach((p, i) => {
      seenIds.add(p.id);
      let card = this.seatCards.get(p.id);
      if (!card) {
        card = new SeatCard();
        this.scene.add(card.sprite);
        this.seatCards.set(p.id, card);
      }
      card.sprite.position.copy(positions[i]);
      card.update({ name: p.name, avatar: p.avatar, activity: p.activity, isHost: p.isHost });
    });

    for (const [id, card] of this.seatCards.entries()) {
      if (!seenIds.has(id)) {
        this.scene.remove(card.sprite);
        card.dispose();
        this.seatCards.delete(id);
      }
    }
  }

  updateMySheetContent(content: PaperVisibleContent) {
    this.paper.drawContent(content);
  }

  setHandState(state: HandState) {
    this.hands.setState(state);
    this.hands.resetClock();
  }

  async playFoldAnimation(snapshot: PaperVisibleContent) {
    this.setHandState("folding");
    soundManager.fold();
    await this.paper.playFold(snapshot);
    this.setHandState("idle");
  }

  async playPassOutAnimation(dir: 1 | -1) {
    this.setHandState("passing");
    soundManager.pass();
    await this.paper.playPassOut(dir);
    this.setHandState("idle");
  }

  async playPassInAnimation(dir: 1 | -1) {
    this.setHandState("receiving");
    soundManager.pass();
    const rest = this.paperRest.clone();
    await this.paper.playPassIn(dir, rest);
    this.setHandState("idle");
  }

  pencilTick() {
    soundManager.pencilTick();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.resize);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.paper.dispose();
    this.hands.dispose();
    for (const card of this.seatCards.values()) card.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

export type { PaperVisibleContent, SheetStyle, HandState };
