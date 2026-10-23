// Простые 3D-руки от первого лица с несколькими keyframe-анимациями.
import * as THREE from "three";

export type HandState = "idle" | "writing" | "folding" | "passing" | "receiving";

export class HandAnimator {
  group = new THREE.Group();
  private left: THREE.Group;
  private right: THREE.Group;
  private pencil: THREE.Mesh;
  private state: HandState = "idle";
  private clock = 0;
  private style: "realistic" | "cartoon" = "realistic";

  constructor(style: "realistic" | "cartoon" = "realistic") {
    this.style = style;
    this.left = buildHand(style, "left");
    this.right = buildHand(style, "right");
    this.left.position.set(-0.46, -0.05, 0.35);
    this.right.position.set(0.46, -0.05, 0.35);
    this.group.add(this.left, this.right);

    const pencilGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 10);
    const pencilMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.5 });
    this.pencil = new THREE.Mesh(pencilGeo, pencilMat);
    this.pencil.rotation.z = Math.PI / 2.4;
    this.pencil.position.set(0.1, 0.05, 0.12);
    this.right.add(this.pencil);
  }

  setStyle(style: "realistic" | "cartoon") {
    this.style = style;
    this.left.children.forEach((c) => updateHandMaterial(c, style));
    this.right.children.forEach((c) => updateHandMaterial(c, style));
  }

  setState(state: HandState) {
    this.state = state;
  }

  update(dt: number) {
    this.clock += dt;
    switch (this.state) {
      case "idle": {
        const bob = Math.sin(this.clock * 1.4) * 0.01;
        this.left.position.y = -0.05 + bob;
        this.right.position.y = -0.05 - bob;
        this.left.rotation.z = Math.sin(this.clock * 0.6) * 0.03;
        this.right.rotation.z = -Math.sin(this.clock * 0.6) * 0.03;
        break;
      }
      case "writing": {
        this.right.position.x = 0.1 + Math.sin(this.clock * 10) * 0.05;
        this.right.position.y = -0.1 + Math.sin(this.clock * 20) * 0.01;
        this.right.rotation.z = Math.sin(this.clock * 10) * 0.08 - 0.2;
        this.left.position.set(-0.46, -0.05, 0.35);
        break;
      }
      case "folding": {
        const t = Math.min(1, this.clock / 1.1);
        this.left.position.set(-0.2, -0.05 + t * 0.12, 0.1 - t * 0.15);
        this.right.position.set(0.2, -0.05 + t * 0.12, 0.1 - t * 0.15);
        this.left.rotation.x = -t * 0.6;
        this.right.rotation.x = -t * 0.6;
        break;
      }
      case "passing": {
        const t = Math.min(1, this.clock / 0.9);
        this.left.position.set(-0.2 + t * 0.8, 0, 0.1);
        this.right.position.set(0.2 + t * 0.8, 0, 0.1);
        break;
      }
      case "receiving": {
        const t = Math.min(1, this.clock / 0.9);
        this.left.position.set(-0.6 + t * 0.4, 0, 0.2);
        this.right.position.set(0.6 - t * 0.4, 0, 0.2);
        break;
      }
    }
  }

  resetClock() {
    this.clock = 0;
  }

  dispose() {
    [this.left, this.right].forEach((hand) => {
      hand.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    });
  }
}

function buildHand(style: "realistic" | "cartoon", side: "left" | "right"): THREE.Group {
  const g = new THREE.Group();
  const color = style === "cartoon" ? 0xffd9a0 : 0xe3b593;
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: style === "cartoon" ? 0.5 : 0.75,
    flatShading: style === "cartoon",
  });
  mat.userData.isHandMaterial = true;

  const palmGeo =
    style === "cartoon"
      ? new THREE.BoxGeometry(0.22, 0.09, 0.3)
      : new THREE.CapsuleGeometry(0.09, 0.22, 4, 8);
  const palm = new THREE.Mesh(palmGeo, mat);
  palm.rotation.x = Math.PI / 2;
  g.add(palm);

  for (let i = 0; i < 4; i++) {
    const fingerGeo = new THREE.CapsuleGeometry(0.018, 0.12, 2, 6);
    const finger = new THREE.Mesh(fingerGeo, mat.clone());
    const spread = (i - 1.5) * 0.06;
    finger.position.set(spread * (side === "left" ? 1 : -1), 0.01, -0.22);
    finger.rotation.x = Math.PI / 2;
    g.add(finger);
  }

  return g;
}

function updateHandMaterial(obj: THREE.Object3D, style: "realistic" | "cartoon") {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshStandardMaterial;
      mat.color.set(style === "cartoon" ? 0xffd9a0 : 0xe3b593);
      mat.roughness = style === "cartoon" ? 0.5 : 0.75;
      mat.flatShading = style === "cartoon";
      mat.needsUpdate = true;
    }
  });
}
