// main.js
// Entry point (ES module)

import * as THREE from "three";
import { state, initDom } from "./StateData.js";
import { initScene } from "./SceneLogic.js";
import { initSelectionLogic } from "./SelectionLogic.js";
import { initTransformLogic} from "./TransformLogic.js";
import { initImportLogic } from "./FileImportLogic.js";
import { entityToSummonCmd, exportOneCommand } from "./CommandBlockLogic.js";
import { initSaveLoadLogic } from "./SaveLoadLogic.js"
import { loadBlockList } from "./TextureLoad.js";
import { initPaletteUI } from "./PaletteUI.js";
import { loadMcmetaAnimatedTexture, tickMcmetaAnimator } from "./BlockAnimationLogic.js";


// -------------------- Init --------------------
const clock = new THREE.Clock();
let markerAnim = null;
let markerMesh = null;

initDom();
await initScene(state);

// --- Command block marker (animated) ---
markerAnim = await loadMcmetaAnimatedTexture(
    "/Resources/textures/block/command_block_front.png",
    "/Resources/textures/block/command_block_front.png.mcmeta"
);

const markerMat = new THREE.MeshBasicMaterial({
  map: markerAnim.tex,
  transparent: true
});

markerMat.toneMapped = false;



markerMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), markerMat);

// flat on ground, slightly raised to avoid z-fighting
markerMesh.rotation.x = -Math.PI / 2;
markerMesh.position.set(-0.5, 0.001, -0.5);

// optional: fight z-fighting even harder
markerMat.polygonOffset = true;
markerMat.polygonOffsetFactor = -1;
markerMat.polygonOffsetUnits = -1;

state.scene.add(markerMesh);


// palette blocks
const BLOCKS = await loadBlockList();

// fill palette
initPaletteUI(state, BLOCKS);

// selection + history + dragging
initSelectionLogic(state);

// transforms + numeric UI + copy/paste hotkeys
initTransformLogic(state);

// reference importing + ref copy/paste support
initImportLogic(state);

// save/load functionality import
initSaveLoadLogic(state);

// -------------------- Left UI actions --------------------
state.ui.placeBtn?.addEventListener("click", () => {
  const p = new THREE.Vector3();
  state.camera.getWorldDirection(p);
  p.multiplyScalar(5).add(state.camera.position);
  p.y = 0;
  state.api.placeAt?.(p);
});

function clearOutList() {
  while (state.ui.outList.firstChild) state.ui.outList.removeChild(state.ui.outList.firstChild);
}

function addCommandBlock(text) {
  const wrap = document.createElement("div");
  wrap.className = "cmdBlock";

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.readOnly = true;

  const btn = document.createElement("button");
  btn.textContent = "Copy";
  btn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy"), 700);
  });

  wrap.appendChild(ta);
  wrap.appendChild(btn);
  state.ui.outList.appendChild(wrap);
}

state.ui.exportManyBtn?.addEventListener("click", () => {
  clearOutList();
  const lines = state.entities.map((ent) => entityToSummonCmd(ent, "~0.5 ~0.5 ~0.5"));
  lines.forEach(addCommandBlock);
});

state.ui.exportOneBtn?.addEventListener("click", () => {
  clearOutList();
  
  const waves = exportOneCommand(state.entities); // now returns array
  waves.forEach(addCommandBlock);
});

// -------------------- Render loop --------------------
function cameraYawDeg() {
  const dir = new THREE.Vector3();
  state.camera.getWorldDirection(dir);
  const yaw = Math.atan2(-dir.x, dir.z) * (180 / Math.PI);
  return (yaw + 360) % 360;
}
function yawToCompass(yaw) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((yaw + 180) % 360) / 45) % 8;
  return dirs[idx];
}

function animate() {
  const dt = clock.getDelta();

  if (markerAnim) tickMcmetaAnimator(markerAnim, dt);

  state.orbit.update();
  state.composer.render();

  // render gizmo scene after
  state.renderer.autoClear = false;
  state.renderer.clearDepth();
  state.renderer.render(state.gizmoScene, state.camera);
  state.renderer.autoClear = true;

  const yaw = cameraYawDeg();
  if (state.ui.facingEl) state.ui.facingEl.textContent = `Facing: ${yawToCompass(yaw)} (${yaw.toFixed(0)}°)`;

  requestAnimationFrame(animate);
}
animate();
