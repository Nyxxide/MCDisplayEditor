import * as THREE from "three";

const MIN_COLLIDER_THICKNESS = 1 / 64;

function clampMinThickness(min, max) {
    for (const axis of ["x", "y", "z"]) {
        const size = max[axis] - min[axis];

        if (size >= MIN_COLLIDER_THICKNESS) continue;

        const c = (min[axis] + max[axis]) * 0.5;
        min[axis] = c - MIN_COLLIDER_THICKNESS * 0.5;
        max[axis] = c + MIN_COLLIDER_THICKNESS * 0.5;
    }
}

function boxFromPoints(points) {
    const box = new THREE.Box3();

    for (const p of points) {
        box.expandByPoint(p);
    }

    clampMinThickness(box.min, box.max);

    return {
        min: box.min.toArray(),
        max: box.max.toArray(),
    };
}

export function makeColliderBoxFromMcElement(from, to, vertexMapper) {
    const [x0, y0, z0] = from;
    const [x1, y1, z1] = to;

    const corners = [
        vertexMapper(x0, y0, z0),
        vertexMapper(x1, y0, z0),
        vertexMapper(x0, y1, z0),
        vertexMapper(x1, y1, z0),

        vertexMapper(x0, y0, z1),
        vertexMapper(x1, y0, z1),
        vertexMapper(x0, y1, z1),
        vertexMapper(x1, y1, z1),
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));

    return boxFromPoints(corners);
}

export function attachColliderBoxes(root, boxes, source = "manual") {
    if (!root) return root;

    const cleaned = (boxes || [])
        .filter((b) => b?.min && b?.max)
        .map((b) => ({
            min: [...b.min],
            max: [...b.max],
        }));

    root.userData.colliderBoxes = cleaned;
    root.userData.colliderSource = source;

    return root;
}

export function attachCollidersFromChildMeshes(root, source = "child-meshes") {
    if (!root) return root;

    root.updateMatrixWorld(true);

    const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const boxes = [];

    root.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry) return;

        obj.updateMatrixWorld(true);

        if (!obj.geometry.boundingBox) {
            obj.geometry.computeBoundingBox();
        }

        const bb = obj.geometry.boundingBox;
        if (!bb) return;

        const m = new THREE.Matrix4()
            .copy(invRoot)
            .multiply(obj.matrixWorld);

        const corners = [
            new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
            new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
            new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
            new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),

            new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
            new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
            new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
            new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
        ].map((p) => p.applyMatrix4(m));

        boxes.push(boxFromPoints(corners));
    });

    attachColliderBoxes(root, boxes, source);
    return root;
}