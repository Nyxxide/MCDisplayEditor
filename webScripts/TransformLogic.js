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
import {gridFine, gridCoarse} from "./SceneLogic.js"

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
        } else {
            // commit temp-rig transforms
            if (state.selectionIsTempRig && transform.object === state.selectionRig) {
                state.api.bakeRigToMeshes?.();
                state.api.rebuildSelectionRig?.();
            }
            state.scaleDragStart = null;
            state.api.pushHistory?.("transform");
        }
    });

    transform.addEventListener("change", () => {
        if (!transform.object) return;

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
            attachTransformToActiveRig(state, transform);
        }
        if (e.key === "e" || e.key === "E") {
            transform.setMode("rotate");
            attachTransformToActiveRig(state, transform);
        }
        if (e.key === "r" || e.key === "R") {
            transform.setMode("scale");
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

function updateSnaps(state, transform) {
    transform.setTranslationSnap(state.shiftHeld ? state.const.TRANS_SNAP : null);
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
