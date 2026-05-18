// 3DEditorSetup/CollisionLogic.js

import * as THREE from "three";

const EPS = 1e-7;
const CONTACT_EPS = 0;
const BACKOFF_EPS = 1e-3;
const MAX_BINARY_STEPS = 14;

const _tmpTranslation = new THREE.Matrix4();

function getEntityMesh(ent) {
    return ent?.mesh || null;
}

function getSelectedEntities(state) {
    if (state.selectedRefId) return [];

    return [...state.selectedIds]
        .map((id) => state.entities.find((e) => e.id === id))
        .filter(Boolean);
}

function getBlockingEntities(state) {
    return state.entities.filter((e) => !state.selectedIds.has(e.id));
}

function localBoxToWorldOBB(box, rootWorldMatrix) {
    const min = new THREE.Vector3().fromArray(box.min);
    const max = new THREE.Vector3().fromArray(box.max);

    const centerLocal = min.clone().add(max).multiplyScalar(0.5);
    const sizeLocal = max.clone().sub(min).multiplyScalar(0.5);

    const center = centerLocal.clone().applyMatrix4(rootWorldMatrix);

    const e = rootWorldMatrix.elements;

    const axisX = new THREE.Vector3(e[0], e[1], e[2]);
    const axisY = new THREE.Vector3(e[4], e[5], e[6]);
    const axisZ = new THREE.Vector3(e[8], e[9], e[10]);

    const sx = axisX.length();
    const sy = axisY.length();
    const sz = axisZ.length();

    if (sx > EPS) axisX.multiplyScalar(1 / sx);
    else axisX.set(1, 0, 0);

    if (sy > EPS) axisY.multiplyScalar(1 / sy);
    else axisY.set(0, 1, 0);

    if (sz > EPS) axisZ.multiplyScalar(1 / sz);
    else axisZ.set(0, 0, 1);

    return {
        center,
        axes: [axisX, axisY, axisZ],
        half: new THREE.Vector3(
            Math.abs(sizeLocal.x * sx),
            Math.abs(sizeLocal.y * sy),
            Math.abs(sizeLocal.z * sz)
        ),
    };
}

function getWorldMatrixWithDelta(obj, delta) {
    obj.updateMatrixWorld(true);

    if (!delta || delta.lengthSq() < EPS) {
        return obj.matrixWorld.clone();
    }

    _tmpTranslation.makeTranslation(delta.x, delta.y, delta.z);
    return _tmpTranslation.clone().multiply(obj.matrixWorld);
}

function collectObjectOBBs(obj, delta = null) {
    if (!obj) return [];

    const boxes = obj.userData?.colliderBoxes;
    if (!Array.isArray(boxes) || boxes.length === 0) return [];

    const world = getWorldMatrixWithDelta(obj, delta);

    return boxes.map((box) => localBoxToWorldOBB(box, world));
}

function obbCorners(obb) {
    const { center, axes, half } = obb;
    const out = [];

    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
                out.push(
                    center.clone()
                        .addScaledVector(axes[0], sx * half.x)
                        .addScaledVector(axes[1], sy * half.y)
                        .addScaledVector(axes[2], sz * half.z)
                );
            }
        }
    }

    return out;
}

function projectedRadius(obb, axis) {
    return (
        obb.half.x * Math.abs(axis.dot(obb.axes[0])) +
        obb.half.y * Math.abs(axis.dot(obb.axes[1])) +
        obb.half.z * Math.abs(axis.dot(obb.axes[2]))
    );
}

function overlapsOnAxis(a, b, axis) {
    const lenSq = axis.lengthSq();
    if (lenSq < EPS) return true;

    const n = axis.clone().multiplyScalar(1 / Math.sqrt(lenSq));
    const dist = Math.abs(b.center.clone().sub(a.center).dot(n));
    const r = projectedRadius(a, n) + projectedRadius(b, n);

    // Touching is allowed. Any actual overlap is not.
    // Do NOT subtract an epsilon here, or drag frames can accumulate sinking.
    return dist < r;
}

function obbIntersectsOBB(a, b) {
    const axes = [
        a.axes[0],
        a.axes[1],
        a.axes[2],
        b.axes[0],
        b.axes[1],
        b.axes[2],
    ];

    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            axes.push(new THREE.Vector3().crossVectors(a.axes[i], b.axes[j]));
        }
    }

    for (const axis of axes) {
        if (!overlapsOnAxis(a, b, axis)) return false;
    }

    return true;
}

function collidesWithFloor(obbs) {
    for (const obb of obbs) {
        for (const c of obbCorners(obb)) {
            // Touching y=0 is allowed. Below y=0 is not.
            if (c.y < 0) return true;
        }
    }

    return false;
}

function anyOBBIntersections(moving, blockers) {
    for (const a of moving) {
        for (const b of blockers) {
            if (obbIntersectsOBB(a, b)) return true;
        }
    }

    return false;
}

function collectBlockerOBBs(state) {
    const out = [];

    for (const ent of getBlockingEntities(state)) {
        const mesh = getEntityMesh(ent);
        out.push(...collectObjectOBBs(mesh));
    }

    return out;
}

function collectSelectionOBBs(state, delta = null) {
    const out = [];

    for (const ent of getSelectedEntities(state)) {
        const mesh = getEntityMesh(ent);
        out.push(...collectObjectOBBs(mesh, delta));
    }

    return out;
}

export function selectionWouldCollideAtDelta(state, delta) {
    const moving = collectSelectionOBBs(state, delta);
    if (!moving.length) return false;

    if (collidesWithFloor(moving)) return true;

    const blockers = collectBlockerOBBs(state);
    return anyOBBIntersections(moving, blockers);
}

function selectionWouldCollideAlongDelta(state, delta, steps = 16) {
    if (!delta || delta.lengthSq() < EPS) return false;

    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const testDelta = delta.clone().multiplyScalar(t);

        if (selectionWouldCollideAtDelta(state, testDelta)) {
            return true;
        }
    }

    return false;
}

function resolveDeltaAlongOneAxis(state, baseDelta, axisDelta) {
    if (!axisDelta || axisDelta.lengthSq() < EPS) {
        return new THREE.Vector3();
    }

    // Only test the candidate axis on top of already-accepted movement.
    // Do NOT include any previously rejected into-wall movement.
    const fullCandidate = baseDelta.clone().add(axisDelta);

    if (!selectionWouldCollideAlongDelta(state, fullCandidate)) {
        return axisDelta.clone();
    }

    let lo = 0;
    let hi = 1;

    for (let i = 0; i < MAX_BINARY_STEPS; i++) {
        const mid = (lo + hi) * 0.5;

        const testAxisDelta = axisDelta.clone().multiplyScalar(mid);
        const testCombined = baseDelta.clone().add(testAxisDelta);

        if (selectionWouldCollideAlongDelta(state, testCombined, 8)) {
            hi = mid;
        } else {
            lo = mid;
        }
    }

    const axisLen = axisDelta.length();
    const allowedDist = Math.max(0, lo * axisLen - BACKOFF_EPS);

    if (allowedDist <= EPS) {
        return new THREE.Vector3();
    }

    return axisDelta.clone().setLength(allowedDist);
}

export function resolveSelectionMoveDelta(state, desiredDelta) {
    if (!desiredDelta || desiredDelta.lengthSq() < EPS) {
        return new THREE.Vector3();
    }

    if (!state.selectedIds || state.selectedIds.size === 0 || state.selectedRefId) {
        return desiredDelta.clone();
    }

    // Key change:
    // Do NOT resolve the whole diagonal vector first.
    // A whole-vector test causes wall/floor contact to freeze unrelated axes.
    const components = [
        new THREE.Vector3(desiredDelta.x, 0, 0),
        new THREE.Vector3(0, desiredDelta.y, 0),
        new THREE.Vector3(0, 0, desiredDelta.z),
    ];

    // Preserve natural drag priority: biggest intended movement first.
    components.sort((a, b) => b.lengthSq() - a.lengthSq());

    const allowed = new THREE.Vector3();

    for (const component of components) {
        if (component.lengthSq() < EPS) continue;

        const step = resolveDeltaAlongOneAxis(state, allowed, component);
        allowed.add(step);
    }

    return allowed;
}

export function debugCountColliderBoxes(state) {
    let total = 0;

    for (const ent of state.entities) {
        const boxes = ent.mesh?.userData?.colliderBoxes;
        if (Array.isArray(boxes)) total += boxes.length;
    }

    return total;
}