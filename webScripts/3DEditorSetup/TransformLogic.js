// TransformLogic.js
// ----------------
// Responsible for:
// - Matrix-safe helpers (world-matrix set + reparent)
// - Block mesh factory (cube)
// - TransformControls wiring + snapping
// - Numeric transform panel sync/apply
// - Copy/Paste hotkeys (Ctrl/Cmd+C/V) + panel buttons

import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {gridFine, gridCoarse} from "./SceneFunctions.js"

/** -------------------- Matrix helpers -------------------- */

let showCoarseGrid = true;

const _tmpM4a = new THREE.Matrix4();
const _tmpM4b = new THREE.Matrix4();

function ensureMatrixDriven(obj) {
    if (!obj) return;
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
}

export function setObjectWorldMatrix(obj, worldMatrix) {
    if (!obj) return;
    ensureMatrixDriven(obj);

    const parent = obj.parent;
    if (parent) {
        parent.updateMatrixWorld(true);
        _tmpM4a.copy(parent.matrixWorld).invert();
        obj.matrix.copy(_tmpM4a.multiply(worldMatrix));
    } else {
        obj.matrix.copy(worldMatrix);
    }
    obj.matrixWorldNeedsUpdate = true;
    obj.updateMatrixWorld(true);
}

export function setObjectWorldTRS(obj, worldMatrix) {
    if (!obj) return;

    // refs must remain TRS-driven for TransformControls & drags
    obj.matrixAutoUpdate = true;

    const parent = obj.parent;
    const local = new THREE.Matrix4();

    if (parent) {
        parent.updateMatrixWorld(true);
        local.copy(parent.matrixWorld).invert().multiply(worldMatrix);
    } else {
        local.copy(worldMatrix);
    }

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    local.decompose(pos, quat, scale);

    obj.position.copy(pos);
    obj.quaternion.copy(quat);
    obj.scale.copy(scale);

    obj.updateMatrixWorld(true);
}

export function attachKeepWorldMatrix(obj, newParent) {
    if (!obj || !newParent) return;

    obj.updateMatrixWorld(true);
    const world = _tmpM4a.copy(obj.matrixWorld);

    if (obj.parent) obj.parent.remove(obj);
    newParent.add(obj);
    newParent.updateMatrixWorld(true);

    _tmpM4b.copy(newParent.matrixWorld).invert();
    const local = _tmpM4b.multiply(world);

    ensureMatrixDriven(obj);
    obj.matrix.copy(local);
    obj.matrixWorldNeedsUpdate = true;
    obj.updateMatrixWorld(true);
}

/** -------------------- TransformControls + UI -------------------- */

export function initTransformLogic(state) {
    const { camera, renderer, gizmoScene } = state;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode("translate");
    transform.setSpace("world"); // important for shear behavior
    gizmoScene.add(transform);

    // hide helper lines/wires
    killGizmoWiresHard(transform);

    // snapping (translation uses built-in snap; rotation uses our absolute snapping)
    updateSnaps(state, transform);

    // ctrl state
    transform.addEventListener("dragging-changed", (e) => {
        state.isTransforming = e.value;
        updateOrbitEnabled(state, transform);

        if (e.value) {
            state.api.stopMeshDrag?.();
            state.api.stopRefDrag?.();

            if (transform.getMode() === "scale" && transform.object) {
                state.scaleDragStart = transform.object.scale.clone();
            } else {
                state.scaleDragStart = null;
            }

            if (transform.getMode() === "translate" && transform.object) {
                beginTranslateSession(state, transform.object);
            } else {
                state.translateSession = null;
            }
        } else {
            // commit temp-rig transforms
            if (state.selectionIsTempRig && transform.object === state.selectionRig) {
                state.api.bakeRigToMeshes?.();
                state.api.rebuildSelectionRig?.();
            }

            state.scaleDragStart = null;
            state.translateSession = null;
            state.api.pushHistory?.("transform");
        }
    });

    transform.addEventListener("change", () => {
        if (!transform.object) return;

        if (transform.getMode() === "translate") {
            applyTranslateConstraints(state, transform.object);
        }

        if (state.shiftHeld && transform.getMode() === "rotate") {
            snapRotationAbsolute(transform.object, state.const.ROT_SNAP_DEG);
        }

        if (state.shiftHeld && transform.getMode() === "scale" && state.scaleDragStart) {
            const obj = transform.object;
            const rxr = safeRatio(obj.scale.x, state.scaleDragStart.x);
            const ryr = safeRatio(obj.scale.y, state.scaleDragStart.y);
            const rzr = safeRatio(obj.scale.z, state.scaleDragStart.z);

            let r = rxr;
            if (Math.abs(ryr - 1) > Math.abs(r - 1)) r = ryr;
            if (Math.abs(rzr - 1) > Math.abs(r - 1)) r = rzr;

            obj.scale.set(
                state.scaleDragStart.x * r,
                state.scaleDragStart.y * r,
                state.scaleDragStart.z * r
            );
        }

        // numeric UI sync
        if (state.selectedRefId && state.activeRig) {
            fillTransformUI(state, state.activeRig);
        } else if (state.selectedIds.size === 1 && !state.selectedRefId) {
            const m = state.api.getOnlySelectedMesh?.();
            if (m) fillTransformUI(state, m);
        } else if (state.selectionBase && state.activeRig && !state.selectionIsTempRig) {
            fillTransformUIRelative(state, state.activeRig, state.selectionBase);
        }

        state.api.updateHighlight?.();
    });

    // numeric input listeners
    hookNumericUI(state);

    // copy/paste buttons
    if (state.ui.copyBtn) state.ui.copyBtn.addEventListener("click", () => doCopy(state));
    if (state.ui.pasteBtn) state.ui.pasteBtn.addEventListener("click", () => doPaste(state, true));

    // hotkeys: Ctrl/Cmd+C/V (ignore when typing in inputs)
    window.addEventListener("keydown", (e) => {
        const isMac = navigator.platform.toLowerCase().includes("mac");
        const mod = isMac ? e.metaKey : e.ctrlKey;

        if (e.key === "Shift") {
            state.shiftHeld = true;
            updateSnaps(state, transform);
        }

        if (e.key === "Tab") {
            if (!isTextInputFocused()) {
                e.preventDefault();
            }
            state.tabHeld = true;
            updateTransformSpace(state, transform);
        }

        // --- Arrow key nudge (camera-cardinal) ---
        if (isArrowKey(e.key)) {
            if (isPaletteOpen(state) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                return;
            }

            if (isNumericOrTextareaFocused()) return;

            e.preventDefault();

            let step = 0.005;
            if (state.tabHeld) step = 1.0;
            else if (e.shiftKey) step = 0.25;

            const did = nudgeSelectedByArrow(state, transform, e.key, step);
            if (did) return;
        }

        if (e.key === "`") {
            if (isTextInputFocused()) return;

            e.preventDefault();

            const did = snapSelectedToHalfBlockCenters(state, transform);
            if (did) return;
        }

        if (isTextInputFocused()) return;

        if (mod && e.key.toLowerCase() === "c") {
            e.preventDefault();
            doCopy(state);
            return;
        }

        if (mod && e.key.toLowerCase() === "v") {
            e.preventDefault();
            doPaste(state, true);
            return;
        }

        // W/E/R mode switching (lets SelectionLogic not care)
        if (e.key === "w" || e.key === "W") {
            transform.setMode("translate");
            updateTransformSpace(state, transform);
            attachTransformToActiveRig(state, transform);
        }
        if (e.key === "e" || e.key === "E") {
            transform.setMode("rotate");
            updateTransformSpace(state, transform);
            attachTransformToActiveRig(state, transform);
        }
        if (e.key === "r" || e.key === "R") {
            transform.setMode("scale");
            updateTransformSpace(state, transform);
            attachTransformToActiveRig(state, transform);
        }
        if (e.key === "h" || e.key === "H") {
                showCoarseGrid = !showCoarseGrid;
                gridFine.visible = !showCoarseGrid;
                gridCoarse.visible = showCoarseGrid;
        }
    });

    window.addEventListener("keyup", (e) => {
        if (e.key === "Shift") {
            state.shiftHeld = false;
            updateSnaps(state, transform);
            if (transform.getMode() === "scale") state.scaleDragStart = null;
        }

        if (e.key === "Tab") {
            state.tabHeld = false;
            updateTransformSpace(state, transform);
        }
    });

    // expose in state
    state.api.transform = transform;
    state.api.attachTransformToActiveRig = () => attachTransformToActiveRig(state, transform);

    return transform;
}

export function attachTransformToActiveRig(state, transform) {
    transform.detach();
    if (!state.activeRig) return;

    const scaleNode = state.activeRig.userData?.scaleNode;
    if (scaleNode && transform.getMode() === "scale") transform.attach(scaleNode);
    else transform.attach(state.activeRig);

    killGizmoWiresHard(transform);
}

function isPaletteOpen(state) {
    const root = state.ui.paletteRoot;
    if (!root) return false;
    return root.dataset.open === "true";
}

function isArrowKey(k) {
    return k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight";
}

function isNumericOrTextareaFocused() {
    const a = document.activeElement;
    if (!a) return false;

    const tag = (a.tagName || "").toLowerCase();
    if (tag === "textarea") return true;

    if (tag === "input") {
        const t = (a.getAttribute("type") || "").toLowerCase();
        // don’t steal arrows from numeric transform fields
        if (t === "number") return true;
    }

    if (a.isContentEditable) return true;
    return false;
}

// returns one of: "N" "E" "S" "W"
function cameraSnappedCardinalVectors(state) {
    const dir = new THREE.Vector3();
    state.camera.getWorldDirection(dir);

    // flatten to XZ plane
    dir.y = 0;

    // if somehow degenerate, default to +Z
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    else dir.normalize();

    // Snap forward to dominant axis (nearest cardinal)
    const ax = Math.abs(dir.x);
    const az = Math.abs(dir.z);

    const fwd = new THREE.Vector3();
    if (ax > az) {
        fwd.set(Math.sign(dir.x) || 1, 0, 0);   // ±X
    } else {
        fwd.set(0, 0, Math.sign(dir.z) || 1);   // ±Z
    }

    // Right vector for that snapped forward (90° clockwise in XZ)
    // If fwd = (0,0,1) => right = (1,0,0)
    // If fwd = (1,0,0) => right = (0,0,-1)
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);

    return { fwd, right };
}

function updateTransformSpace(state, transform) {
    // Tab is now reserved for arrow-key stepping only.
    // Gizmo translate should always stay in world space.
    transform.setSpace("world");
}

function getWorldPositionOf(obj) {
    const v = new THREE.Vector3();
    obj.updateMatrixWorld(true);
    obj.getWorldPosition(v);
    return v;
}

function setWorldPositionOf(obj, worldPos) {
    if (!obj) return;

    if (obj.parent) {
        obj.parent.updateMatrixWorld(true);
        const local = worldPos.clone();
        obj.parent.worldToLocal(local);
        obj.position.copy(local);
    } else {
        obj.position.copy(worldPos);
    }

    obj.updateMatrixWorld(true);
}

function beginTranslateSession(state, obj) {
    const startWorld = getWorldPositionOf(obj);
    const startQuat = new THREE.Quaternion();
    obj.getWorldQuaternion(startQuat);

    const basisX = new THREE.Vector3(1, 0, 0).applyQuaternion(startQuat).normalize();
    const basisY = new THREE.Vector3(0, 1, 0).applyQuaternion(startQuat).normalize();
    const basisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(startQuat).normalize();

    state.translateSession = {
        startWorld,
        basisX,
        basisY,
        basisZ,
        prevRawDeltaLocal: { x: 0, y: 0, z: 0 },
    };
}

function applyTranslateConstraints(state, obj) {
    if (!state.translateSession) return;

    // SHIFT: 0.25 incremental motion from drag start, not absolute grid lock.
    if (state.shiftHeld) {
        applyIncrementalTranslateSnap(state, obj, 0.25);
    }
}

function applyIncrementalTranslateSnap(state, obj, step) {
    const session = state.translateSession;
    if (!session) return;

    const curWorld = getWorldPositionOf(obj);
    const delta = curWorld.clone().sub(session.startWorld);

    delta.x = Math.round(delta.x / step) * step;
    delta.y = Math.round(delta.y / step) * step;
    delta.z = Math.round(delta.z / step) * step;

    const snappedWorld = session.startWorld.clone().add(delta);
    setWorldPositionOf(obj, snappedWorld);
}


function nudgeSelectedByArrow(state, transform, key, step) {
    if (!state.activeRig) return false;

    // don’t fight with gizmo dragging / plane drags
    if (state.isTransforming || transform?.dragging || state.isDraggingMesh || state.isDraggingRef) return false;

    const { fwd, right } = cameraSnappedCardinalVectors(state);

    const delta = new THREE.Vector3();
    if (key === "ArrowUp") delta.copy(fwd);
    if (key === "ArrowDown") delta.copy(fwd).multiplyScalar(-1);
    if (key === "ArrowRight") delta.copy(right).multiplyScalar(-1);
    if (key === "ArrowLeft") delta.copy(right);

    delta.multiplyScalar(step);

    // Refs are TRS driven; blocks/groups are matrix driven but you move the rig
    const rig = state.activeRig;

    rig.position.add(delta);
    rig.updateMatrixWorld(true);

    // If we’re using the temp selectionRig, we must bake so meshes actually move in world
    if (state.selectionIsTempRig && rig === state.selectionRig) {
        state.api.bakeRigToMeshes?.();
        state.api.rebuildSelectionRig?.();
    }

    // Update UI + outline
    if (state.selectedRefId && state.activeRig) {
        fillTransformUI(state, state.activeRig);
    } else if (state.selectedIds.size === 1 && !state.selectedRefId) {
        const m = state.api.getOnlySelectedMesh?.();
        if (m) fillTransformUI(state, m);
    } else if (state.selectionBase && state.activeRig && !state.selectionIsTempRig) {
        fillTransformUIRelative(state, state.activeRig, state.selectionBase);
    }

    state.api.updateHighlight?.();
    state.api.pushHistory?.("nudge");
    return true;
}

function snapHalfCentered(v) {
    // Allowed lattice: ..., -1.5, -0.5, 0.5, 1.5, 2.5, ...
    // Ties like 1.0 / 2.0 / 0.0 fall to the lower .5 value.
    return Math.floor(v) + 0.5;
}

function snapSelectedToHalfBlockCenters(state, transform) {
    if (!state.activeRig) return false;

    // don’t fight with gizmo dragging / plane drags
    if (state.isTransforming || transform?.dragging || state.isDraggingMesh || state.isDraggingRef) {
        return false;
    }

    // --- Single selected block: snap the actual mesh world origin,
    // not the temp selection rig center / bbox center. ---
    if (state.selectedIds.size === 1 && !state.selectedRefId) {
        const mesh = state.api.getOnlySelectedMesh?.();
        if (!mesh) return false;

        const wpos = new THREE.Vector3();
        const wquat = new THREE.Quaternion();
        const wscale = new THREE.Vector3();

        mesh.updateMatrixWorld(true);
        mesh.matrixWorld.decompose(wpos, wquat, wscale);

        wpos.set(
            snapHalfCentered(wpos.x),
            snapHalfCentered(wpos.y),
            snapHalfCentered(wpos.z)
        );

        const world = new THREE.Matrix4().compose(wpos, wquat, wscale);
        setObjectWorldMatrix(mesh, world);

        state.api.rebuildSelectionRig?.();
        fillTransformUI(state, mesh);
        state.api.updateHighlight?.();
        state.api.pushHistory?.("snap-half-block");
        return true;
    }

    // --- Group / ref / other rig-driven selection: snap the rig/root position. ---
    const rig = state.activeRig;

    rig.position.set(
        snapHalfCentered(rig.position.x),
        snapHalfCentered(rig.position.y),
        snapHalfCentered(rig.position.z)
    );

    rig.updateMatrixWorld(true);

    if (state.selectionIsTempRig && rig === state.selectionRig) {
        state.api.bakeRigToMeshes?.();
        state.api.rebuildSelectionRig?.();
    }

    if (state.selectedRefId && state.activeRig) {
        fillTransformUI(state, state.activeRig);
    } else if (state.selectionBase && state.activeRig && !state.selectionIsTempRig) {
        fillTransformUIRelative(state, state.activeRig, state.selectionBase);
    }

    state.api.updateHighlight?.();
    state.api.pushHistory?.("snap-half-block");
    return true;
}

function updateSnaps(state, transform) {
    // translation snapping is handled manually so group motion is incremental
    // from the drag start instead of locking to the global 0.25 grid.
    transform.setTranslationSnap(null);
    transform.setRotationSnap(null); // we do absolute snapping ourselves
}

function updateOrbitEnabled(state, transform) {
    if (!state.orbit) return;
    state.orbit.enabled = !(state.isTransforming || transform.dragging || state.isDraggingMesh || state.isDraggingRef);
}

function killGizmoWiresHard(transform) {
    transform.traverse((o) => {
        if (o.type === "Line" || o.type === "LineSegments") o.visible = false;
        if (o.type === "Mesh") {
            const nn = (o.name || "").toUpperCase();
            if (nn.includes("HELPER") || nn.includes("START") || nn.includes("END") || nn.includes("DELTA")) {
                o.visible = false;
            }
        }
    });
}

function snapRotationAbsolute(obj, stepDeg) {
    const e = new THREE.Euler().setFromQuaternion(obj.quaternion, "XYZ");
    const sx = Math.round(THREE.MathUtils.radToDeg(e.x) / stepDeg) * stepDeg;
    const sy = Math.round(THREE.MathUtils.radToDeg(e.y) / stepDeg) * stepDeg;
    const sz = Math.round(THREE.MathUtils.radToDeg(e.z) / stepDeg) * stepDeg;

    e.set(
        THREE.MathUtils.degToRad(sx),
        THREE.MathUtils.degToRad(sy),
        THREE.MathUtils.degToRad(sz),
        "XYZ"
    );
    obj.quaternion.setFromEuler(e);
}

function safeRatio(a, b) {
    if (Math.abs(b) < 1e-8) return 1;
    return a / b;
}

/** -------------------- Numeric UI -------------------- */

function hookNumericUI(state) {
    const { px, py, pz, rx, ry, rz, sx, sy, sz } = state.ui;
    const inputs = [px, py, pz, rx, ry, rz, sx, sy, sz].filter(Boolean);
    for (const el of inputs) el.addEventListener("change", () => applyTransformFromUI(state));
}

function degToRad(d) {
    return (d * Math.PI) / 180;
}

function setEulerDegQuaternion(ex, ey, ez) {
    const e = new THREE.Euler(degToRad(ex), degToRad(ey), degToRad(ez), "YXZ");
    const q = new THREE.Quaternion();
    q.setFromEuler(e);
    return q;
}

export function fillTransformUI(state, obj) {
    const { px, py, pz, rx, ry, rz, sx, sy, sz } = state.ui;
    if (!obj || !px) return;

    const wpos = new THREE.Vector3();
    const wquat = new THREE.Quaternion();
    const wscale = new THREE.Vector3();

    obj.updateMatrixWorld(true);
    obj.getWorldPosition(wpos);
    obj.getWorldQuaternion(wquat);
    obj.getWorldScale(wscale);

    px.value = wpos.x.toFixed(3);
    py.value = wpos.y.toFixed(3);
    pz.value = wpos.z.toFixed(3);

    const e = new THREE.Euler().setFromQuaternion(wquat, "XYZ");
    rx.value = THREE.MathUtils.radToDeg(e.x).toFixed(1);
    ry.value = THREE.MathUtils.radToDeg(e.y).toFixed(1);
    rz.value = THREE.MathUtils.radToDeg(e.z).toFixed(1);

    sx.value = wscale.x.toFixed(3);
    sy.value = wscale.y.toFixed(3);
    sz.value = wscale.z.toFixed(3);
}

export function fillTransformUIRelative(state, obj, base) {
    const { px, py, pz, rx, ry, rz, sx, sy, sz } = state.ui;
    if (!obj || !base || !px) return;

    const wpos = new THREE.Vector3();
    const wquat = new THREE.Quaternion();
    const wscale = new THREE.Vector3();

    obj.updateMatrixWorld(true);
    obj.getWorldPosition(wpos);
    obj.getWorldQuaternion(wquat);

    const sn = obj.userData?.scaleNode || obj;
    sn.updateMatrixWorld(true);
    sn.getWorldScale(wscale);

    const dq = base.quat.clone().invert().multiply(wquat);
    const de = new THREE.Euler().setFromQuaternion(dq, "XYZ");

    const rdeg = {
        x: THREE.MathUtils.radToDeg(de.x),
        y: THREE.MathUtils.radToDeg(de.y),
        z: THREE.MathUtils.radToDeg(de.z),
    };

    const rscale = new THREE.Vector3(
        safeRatio(wscale.x, base.scale.x),
        safeRatio(wscale.y, base.scale.y),
        safeRatio(wscale.z, base.scale.z)
    );

    px.value = wpos.x.toFixed(3);
    py.value = wpos.y.toFixed(3);
    pz.value = wpos.z.toFixed(3);

    rx.value = rdeg.x.toFixed(1);
    ry.value = rdeg.y.toFixed(1);
    rz.value = rdeg.z.toFixed(1);

    sx.value = rscale.x.toFixed(3);
    sy.value = rscale.y.toFixed(3);
    sz.value = rscale.z.toFixed(3);
}

function applyTransformFromUI(state) {
    const { px, py, pz, rx, ry, rz, sx, sy, sz } = state.ui;

    const refEdit = !!state.selectedRefId && state.activeRig;
    const single = state.selectedIds.size === 1 && !state.selectedRefId;
    const exactGroup = state.api.exactGroupForSelection?.();
    const groupEdit = !!exactGroup;

    if (!single && !groupEdit && !refEdit) return;

    if (refEdit) {
        state.activeRig.position.set(
            parseFloat(px.value) || 0,
            parseFloat(py.value) || 0,
            parseFloat(pz.value) || 0
        );

        const q = setEulerDegQuaternion(
            parseFloat(rx.value) || 0,
            parseFloat(ry.value) || 0,
            parseFloat(rz.value) || 0
        );
        state.activeRig.quaternion.copy(q);

        state.activeRig.scale.set(
            parseFloat(sx.value) || 1,
            parseFloat(sy.value) || 1,
            parseFloat(sz.value) || 1
        );

        state.activeRig.updateMatrixWorld(true);
        state.api.pushHistory?.("numeric-ref");
        return;
    }

    if (single) {
        const mesh = state.api.getOnlySelectedMesh?.();
        if (!mesh) return;

        const wpos = new THREE.Vector3(
            parseFloat(px.value) || 0,
            parseFloat(py.value) || 0,
            parseFloat(pz.value) || 0
        );

        const wquat = setEulerDegQuaternion(
            parseFloat(rx.value) || 0,
            parseFloat(ry.value) || 0,
            parseFloat(rz.value) || 0
        );

        const wscale = new THREE.Vector3(
            parseFloat(sx.value) || 1,
            parseFloat(sy.value) || 1,
            parseFloat(sz.value) || 1
        );

        const world = new THREE.Matrix4().compose(wpos, wquat, wscale);
        setObjectWorldMatrix(mesh, world);

        state.api.rebuildSelectionRig?.();
        state.api.pushHistory?.("numeric");
        return;
    }

    // group edit
    if (!state.activeRig || !state.selectionBase) return;

    const ax = parseFloat(px.value);
    const ay = parseFloat(py.value);
    const az = parseFloat(pz.value);

    const drx = degToRad(parseFloat(rx.value) || 0);
    const dry = degToRad(parseFloat(ry.value) || 0);
    const drz = degToRad(parseFloat(rz.value) || 0);

    const rsx = parseFloat(sx.value) || 1;
    const rsy = parseFloat(sy.value) || 1;
    const rsz = parseFloat(sz.value) || 1;

    if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az)) {
        state.activeRig.position.set(ax, ay, az);
    }

    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(drx, dry, drz, "XYZ"));
    state.activeRig.quaternion.copy(state.selectionBase.quat).multiply(dq);

    const sn = state.activeRig.userData?.scaleNode || state.activeRig;
    sn.scale.set(
        state.selectionBase.scale.x * rsx,
        state.selectionBase.scale.y * rsy,
        state.selectionBase.scale.z * rsz
    );

    state.activeRig.updateMatrixWorld(true);
    state.api.pushHistory?.("numeric");
}

/** -------------------- Copy / Paste -------------------- */

function doCopy(state) {
    const exactGroup = state.api.exactGroupForSelection?.();
    if (exactGroup) {
        const g = state.api.serializeSelectedGroup?.();
        if (!g) return;

        state.groupClipboard = g;
        state.blockClipboard = null;
        state.refClipboard = null;
        return;
    }

    const b = state.api.serializeSelectedBlock?.();
    if (b) {
        state.blockClipboard = b;
        state.refClipboard = null;
        state.groupClipboard = null;
    }

    if (state.selectedRefId) {
        const r = state.api.serializeSelectedRef?.();
        if (!r) return;

        state.refClipboard = r;
        state.blockClipboard = null;
        state.groupClipboard = null;
        return;
    }
}

function doPaste(state, offset = true) {
    if (state.groupClipboard) {
        state.api.pasteGroupFromClipboard?.(offset);
        return;
    }
    if (state.blockClipboard) {
        state.api.pasteBlockFromClipboard?.(offset);
        return;
    }
    if (state.refClipboard) {
        state.api.pasteRefFromClipboard?.(offset);
    }
}


function isTextInputFocused() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = a.tagName ? a.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea") return true;
    if (a.isContentEditable) return true;
    return false;
}
