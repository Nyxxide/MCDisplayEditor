// SelectionLogic.js
// ----------------
// Responsible for:
// - Picking (blocks + refs)
// - Click selection, Ctrl multiselect, box select, plane drag
// - Group/ungroup (node rig)
// - Delete
// - Undo/redo snapshots
// - Outline highlighting

import * as THREE from "three";
import { attachKeepWorldMatrix, setObjectWorldMatrix, setObjectWorldTRS } from "./TransformLogic.js";
import { makeCubeForBlock } from "../TextureLoading/TextureLoad.js"
import {getDefaultPropertiesForBlock} from "../TextureLoading/BlockPropertyOptions.js";
import { resolveSelectionMoveDelta } from "./CollisionLogic.js"

export function initSelectionLogic(state) {
    // --- Selection box element (DOM overlay) ---
    const selBox = document.createElement("div");
    selBox.style.position = "fixed";
    selBox.style.border = "1px dashed rgba(255,255,255,0.9)";
    selBox.style.background = "rgba(255,255,255,0.08)";
    selBox.style.pointerEvents = "none";
    selBox.style.display = "none";
    selBox.style.zIndex = "9999";
    document.body.appendChild(selBox);

    if (state.ui.groupBtn) {
        state.ui.groupBtn.addEventListener("click", () => groupSelected());
    }

    if (state.ui.ungroupBtn) {
        state.ui.ungroupBtn.addEventListener("click", () => ungroupSelection());
    }

    // --- Raycast + ground plane ---
    const xzPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const dragPlane = new THREE.Plane();
    const dragPlanePoint = new THREE.Vector3();
    const dragPlaneNormal = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // --- Shadow indicator for selection ---
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.6, 32),
        new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.15,
            depthWrite: false,
        })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.visible = false;
    shadow.renderOrder = 2;
    state.scene.add(shadow);

    // expose hooks used elsewhere
    state.api.shadow = shadow;

    // ----------- helpers -----------
    function screenToRay(e) {
        const rect = state.renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, state.camera);
    }

    function modalOpen() {
        const modals = document.querySelectorAll(".modalOverlay");
        for (const m of modals) {
            if (window.getComputedStyle(m).display !== "none") return true;
        }
        return false;
    }

    function getGroundPoint(e) {
        screenToRay(e);
        const point = new THREE.Vector3();
        raycaster.ray.intersectPlane(xzPlane, point);
        return point;
    }

    function chooseCameraRelativeDragPlaneNormal() {
        const dir = new THREE.Vector3();
        state.camera.getWorldDirection(dir);

        const ax = Math.abs(dir.x);
        const ay = Math.abs(dir.y);
        const az = Math.abs(dir.z);

        // Pick the world axis the camera is looking along most.
        // Movement happens on the other two axes.
        if (ay >= ax && ay >= az) return new THREE.Vector3(0, 1, 0); // XZ plane
        if (ax >= ay && ax >= az) return new THREE.Vector3(1, 0, 0); // YZ plane
        return new THREE.Vector3(0, 0, 1);                           // XY plane
    }

    function beginCameraRelativeDragPlane(e, objectWorldPos) {
        dragPlanePoint.copy(objectWorldPos);
        dragPlaneNormal.copy(chooseCameraRelativeDragPlaneNormal());

        dragPlane.setFromNormalAndCoplanarPoint(dragPlaneNormal, dragPlanePoint);

        screenToRay(e);

        const p = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(dragPlane, p)) {
            p.copy(objectWorldPos);
        }

        return p;
    }

    function getCameraRelativeDragPoint(e) {
        screenToRay(e);

        const p = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(dragPlane, p)) {
            p.copy(dragPlanePoint);
        }

        return p;
    }

    function worldToScreen(v3) {
        const rect = state.renderer.domElement.getBoundingClientRect();

        const v = v3.clone().project(state.camera);

        const x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
        const y = (-v.y * 0.5 + 0.5) * rect.height + rect.top;

        return { x, y, ndcZ: v.z };
    }

    function entityByObject(obj) {
        let p = obj;
        while (p) {
            const ent = state.entities.find((x) => x.mesh === p);
            if (ent) return ent;
            p = p.parent;
        }
        return null;
    }

    function meshById(id) {
        const ent = state.entities.find((x) => x.id === id);
        return ent ? ent.mesh : null;
    }

    function getOnlySelectedMesh() {
        if (state.selectedIds.size !== 1) return null;
        const id = [...state.selectedIds][0];
        return meshById(id);
    }

    function groupForMember(id) {
        return state.groups.find((g) => g.members.includes(id)) || null;
    }

    function exactGroupForSelection() {
        if (state.selectedIds.size < 2) return null;
        const sel = [...state.selectedIds].slice().sort();
        for (const g of state.groups) {
            if (g.members.length !== sel.length) continue;
            const gm = [...g.members].slice().sort();
            if (gm.every((v, i) => v === sel[i])) return g;
        }
        return null;
    }

    function expandIdsByGroups(idsIterable) {
        const out = new Set(idsIterable);
        let changed = true;

        while (changed) {
            changed = false;
            for (const g of state.groups) {
                const touches = g.members.some((m) => out.has(m));
                if (touches) {
                    for (const m of g.members) {
                        if (!out.has(m)) {
                            out.add(m);
                            changed = true;
                        }
                    }
                }
            }
        }
        return out;
    }

    function updateOrbitEnabled() {
        const transform = state.api.transform;
        if (!state.orbit || !transform) return;
        state.orbit.enabled = !(state.isTransforming || transform.dragging || state.isDraggingMesh || state.isDraggingRef);
    }

    function stopMeshDrag() {
        state.isDraggingMesh = false;
        updateOrbitEnabled();
    }

    function stopRefDrag() {
        state.isDraggingRef = false;
        updateOrbitEnabled();
    }

    // ---- selection rig emptying / baking ----
    function emptySelectionRig() {
        const rig = state.selectionRig;
        rig.updateMatrixWorld(true);

        const scaleNode = rig.userData?.scaleNode || rig;
        const kids = [...scaleNode.children];
        for (const k of kids) attachKeepWorldMatrix(k, state.scene);

        scaleNode.clear();
    }

    function bakeRigToMeshes() {
        const rig = state.selectionRig;
        rig.updateMatrixWorld(true);

        const scaleNode = rig.userData?.scaleNode || rig;
        const children = [...scaleNode.children];
        for (const obj of children) attachKeepWorldMatrix(obj, state.scene);

        rig.position.set(0, 0, 0);
        rig.quaternion.identity();
        rig.scale.set(1, 1, 1);

        scaleNode.position.set(0, 0, 0);
        scaleNode.quaternion.identity();
        scaleNode.scale.set(1, 1, 1);

        rig.updateMatrixWorld(true);
    }


    // ---- group nodes ----
    function ensureGroupNode(g) {
        let root = state.groupNodes.get(g.id);
        if (root) return root;

        root = new THREE.Group();
        root.name = `group:${g.id}:root`;

        const scaleNode = new THREE.Group();
        scaleNode.name = `group:${g.id}:scale`;
        root.add(scaleNode);
        root.userData.scaleNode = scaleNode;

        state.scene.add(root);
        state.groupNodes.set(g.id, root);

        // center by bbox
        const box = new THREE.Box3();
        for (const id of g.members) {
            const m = meshById(id);
            if (m) box.expandByObject(m);
        }
        const center = box.getCenter(new THREE.Vector3());

        root.position.copy(center);
        root.quaternion.identity();
        root.scale.set(1, 1, 1);

        scaleNode.position.set(0, 0, 0);
        scaleNode.quaternion.identity();
        scaleNode.scale.set(1, 1, 1);

        root.updateMatrixWorld(true);

        for (const id of g.members) {
            const m = meshById(id);
            if (m) attachKeepWorldMatrix(m, scaleNode);
        }

        return root;
    }

    function removeGroupNode(groupId) {
        const root = state.groupNodes.get(groupId);
        if (!root) return;

        const scaleNode = root.userData?.scaleNode || root;
        const kids = [...scaleNode.children];
        for (const obj of kids) attachKeepWorldMatrix(obj, state.scene);

        state.scene.remove(root);
        state.groupNodes.delete(groupId);
    }

    // ---- selection / ref selection ----
    function clearSelection({ keepUI = false } = {}) {
        emptySelectionRig();

        state.selectedIds.clear();
        state.selectedRefId = null;

        state.api.transform?.detach();
        shadow.visible = false;

        state.activeRig = null;
        state.selectionIsTempRig = false;
        state.selectionBase = null;

        if (!keepUI && state.ui.xformUI) state.ui.xformUI.style.display = "none";

        updateXformPanelState();
        updateHighlight();
    }

    function selectReference(ref) {
        emptySelectionRig();
        state.selectedIds.clear();
        state.selectionIsTempRig = false;
        state.selectionBase = null;

        state.selectedRefId = ref.id;
        state.activeRig = ref.root;

        state.api.attachTransformToActiveRig?.();
        shadow.visible = true;

        state.api.fillTransformUI?.(ref.root);
        updateXformPanelState();
        updateHighlight();
    }

    function rebuildSelectionRig() {
        state.api.transform?.detach();
        emptySelectionRig();

        if (state.selectedIds.size === 0) {
            shadow.visible = false;
            state.activeRig = null;
            state.selectionIsTempRig = false;
            state.selectionBase = null;
            updateHighlight();
            updateXformPanelState();
            return;
        }

        const expanded = expandIdsByGroups(state.selectedIds);
        state.selectedIds.clear();
        for (const id of expanded) state.selectedIds.add(id);

        const exactGroup = exactGroupForSelection();
        if (exactGroup) {
            const node = ensureGroupNode(exactGroup);
            state.activeRig = node;
            state.selectionIsTempRig = false;

            // baseline for relative UI
            if (!node.userData.selectionBase) {
                const p = new THREE.Vector3();
                const q = new THREE.Quaternion();
                const s = new THREE.Vector3();

                node.updateMatrixWorld(true);
                node.getWorldPosition(p);
                node.getWorldQuaternion(q);

                const sn = node.userData?.scaleNode || node;
                sn.updateMatrixWorld(true);
                sn.getWorldScale(s);

                node.userData.selectionBase = { pos: p, quat: q, scale: s };
            }

            state.selectionBase = node.userData.selectionBase;

            state.api.attachTransformToActiveRig?.();
            state.api.fillTransformUIRelative?.(node, state.selectionBase);

            shadow.visible = true;
            updateHighlight();
            updateXformPanelState();
            return;
        }

        // temp rig at bbox center
        const box = new THREE.Box3();
        for (const id of state.selectedIds) {
            const m = meshById(id);
            if (!m) continue;
            box.expandByObject(m);
        }
        const center = box.getCenter(new THREE.Vector3());

        const rig = state.selectionRig;
        rig.position.copy(center);
        rig.quaternion.identity();
        rig.scale.set(1, 1, 1);
        rig.updateMatrixWorld(true);

        const scaleNode = rig.userData.scaleNode;
        for (const id of state.selectedIds) {
            const m = meshById(id);
            if (!m) continue;
            attachKeepWorldMatrix(m, scaleNode);
        }

        state.activeRig = rig;
        state.selectionIsTempRig = true;
        state.selectionBase = null;

        state.api.attachTransformToActiveRig?.();
        shadow.visible = true;
        updateHighlight();
        updateXformPanelState();
    }

    // ---- outline highlight ----
    function updateHighlight() {
        const outlinePass = state.post.outlinePass;
        if (!outlinePass) return;

        if (state.selectedRefId) {
            const r = state.refs.find((x) => x.id === state.selectedRefId);
            outlinePass.selectedObjects = r ? [r.root] : [];
            return;
        }

        if (state.selectedIds.size === 0) {
            outlinePass.selectedObjects = [];
            return;
        }

        const objs = [];
        for (const id of state.selectedIds) {
            const m = meshById(id);
            if (m) objs.push(m);
        }
        outlinePass.selectedObjects = objs;
    }

    // ---- xform panel enable/disable ----
    function updateXformPanelState() {
        const hasSel = state.selectedIds.size > 0 || !!state.selectedRefId;
        if (state.ui.xformUI) state.ui.xformUI.style.display = hasSel ? "block" : "none";
        if (!hasSel) return;

        const singleBlock = state.selectedIds.size === 1 && !state.selectedRefId;
        const exactGroup = exactGroupForSelection();
        const groupEdit = !!exactGroup;
        const refEdit = !!state.selectedRefId;

        const editable = singleBlock || groupEdit || refEdit;
        for (const el of [state.ui.px, state.ui.py, state.ui.pz, state.ui.rx, state.ui.ry, state.ui.rz, state.ui.sx, state.ui.sy, state.ui.sz]) {
            if (!el) continue;
            el.disabled = !editable;
        }

        if (refEdit && state.activeRig) {
            state.api.fillTransformUI?.(state.activeRig);
        } else if (singleBlock) {
            const m = getOnlySelectedMesh();
            if (m) state.api.fillTransformUI?.(m);
        } else if (groupEdit && state.activeRig && state.selectionBase) {
            state.api.fillTransformUIRelative?.(state.activeRig, state.selectionBase);
        }
        state.api.fillMetaUI?.();

        const canGroup =
            !refEdit &&
            state.selectedIds.size >= 2 &&
            !groupEdit;

        const canUngroup =
            !refEdit &&
            groupEdit;

        if (state.ui.groupBtn) {
            state.ui.groupBtn.disabled = !canGroup;
        }

        if (state.ui.ungroupBtn) {
            state.ui.ungroupBtn.disabled = !canUngroup;
        }
    }

    // ---- grouping ----
    function groupSelected() {
        if (state.selectedRefId) return;
        if (state.selectedIds.size < 2) return;

        const members = [...state.selectedIds].slice().sort();

        const exists = state.groups.some((g) => {
            const a = [...g.members].slice().sort();
            if (a.length !== members.length) return false;
            return a.every((v, i) => v === members[i]);
        });
        if (exists) return;

        const g = { id: crypto.randomUUID(), members };
        state.groups.push(g);

        ensureGroupNode(g);

        state.selectedIds.clear();
        for (const id of g.members) state.selectedIds.add(id);

        rebuildSelectionRig();
        state.api.pushHistory?.("group");
        updateXformPanelState();
    }

    function ungroupSelection() {
        if (state.selectedRefId) return;
        if (state.selectedIds.size === 0) return;

        let changed = false;
        for (let i = state.groups.length - 1; i >= 0; i--) {
            const g = state.groups[i];
            const touches = g.members.some((id) => state.selectedIds.has(id));
            if (touches) {
                removeGroupNode(g.id);
                state.groups.splice(i, 1);
                changed = true;
            }
        }

        if (changed) {
            rebuildSelectionRig();
            state.api.pushHistory?.("ungroup");
            updateXformPanelState();
        }
    }

    // ---- copy/paste blocks for TransformLogic ----
    function serializeEntity(ent) {
        ent.mesh.updateMatrixWorld(true);
        return {
            blockName: ent.blockName,
            properties: ent.properties ?? null,
            tags: Array.isArray(ent.tags) ? [...ent.tags] : [],
            viewRange: ent.viewRange ?? null,
            brightness: ent.brightness ?? null,
            shadowRadius: ent.shadowRadius ?? null,
            shadowStrength: ent.shadowStrength ?? null,
            mat: ent.mesh.matrixWorld.elements.slice()
        };
    }

    function serializeSelectedBlock() {
        if (state.selectedIds.size !== 1 || state.selectedRefId) return null;
        const id = [...state.selectedIds][0];
        const ent = state.entities.find((x) => x.id === id);
        if (!ent) return null;
        return serializeEntity(ent);
    }

    function serializeSelectedGroup() {
        const g = exactGroupForSelection();
        if (!g) return null;

        const items = [];
        for (const id of g.members) {
            const ent = state.entities.find(e => e.id === id);
            if (!ent) continue;
            ent.mesh.updateMatrixWorld(true);
            items.push({
                blockName: ent.blockName,
                properties: ent.properties ?? null,
                tags: Array.isArray(ent.tags) ? [...ent.tags] : [],
                viewRange: ent.viewRange ?? null,
                brightness: ent.brightness ?? null,
                shadowRadius: ent.shadowRadius ?? null,
                shadowStrength: ent.shadowStrength ?? null,
                mat: ent.mesh.matrixWorld.elements.slice(),
            });
        }

        if (!items.length) return null;
        return { items };
    }

    function serializeSelectedMulti() {
        if (state.selectedRefId) return null;
        if (state.selectedIds.size < 2) return null;

        const items = [];

        for (const id of state.selectedIds) {
            const ent = state.entities.find(e => e.id === id);
            if (!ent) continue;

            ent.mesh.updateMatrixWorld(true);

            items.push({
                blockName: ent.blockName,
                properties: ent.properties ?? null,
                tags: Array.isArray(ent.tags) ? [...ent.tags] : [],
                viewRange: ent.viewRange ?? null,
                brightness: ent.brightness ?? null,
                shadowRadius: ent.shadowRadius ?? null,
                shadowStrength: ent.shadowStrength ?? null,
                mat: ent.mesh.matrixWorld.elements.slice()
            });
        }

        if (!items.length) return null;
        return { items };
    }

    async function pasteBlockFromClipboard(offset = true) {
        if (!state.blockClipboard) return;

        const mesh = await makeCubeForBlock(
            state,
            state.blockClipboard.blockName,
            state.blockClipboard.properties ?? null
        );

        const m = new THREE.Matrix4().fromArray(state.blockClipboard.mat);

        if (offset) {
            m.premultiply(new THREE.Matrix4().makeTranslation(1, 0, 0));
        }

        state.scene.add(mesh);
        setObjectWorldMatrix(mesh, m);

        const id = crypto.randomUUID();
        state.entities.push({
            id,
            blockName: state.blockClipboard.blockName,
            properties: state.blockClipboard.properties ?? null,

            tags: Array.isArray(state.blockClipboard.tags) ? [...state.blockClipboard.tags] : [],
            viewRange: state.blockClipboard.viewRange ?? null,
            brightness: state.blockClipboard.brightness ?? null,
            shadowRadius: state.blockClipboard.shadowRadius ?? null,
            shadowStrength: state.blockClipboard.shadowStrength ?? null,

            mesh
        });

        state.selectedRefId = null;
        state.selectedIds.clear();
        state.selectedIds.add(id);
        rebuildSelectionRig();

        state.api.pushHistory?.("paste");
    }

    async function pasteGroupFromClipboard(offset = true) {
        if (!state.groupClipboard) return;

        const t = offset
            ? new THREE.Matrix4().makeTranslation(1, 0, 0)
            : new THREE.Matrix4().identity();

        const newIds = [];

        for (const it of state.groupClipboard.items) {
            const mesh = await makeCubeForBlock(
                state,
                it.blockName,
                it.properties ?? null
            );

            const m = new THREE.Matrix4().fromArray(it.mat).premultiply(t);

            state.scene.add(mesh);
            setObjectWorldMatrix(mesh, m);

            const id = crypto.randomUUID();
            state.entities.push({
                id,
                blockName: it.blockName,
                properties: it.properties ?? null,

                tags: Array.isArray(it.tags) ? [...it.tags] : [],
                viewRange: it.viewRange ?? null,
                brightness: it.brightness ?? null,
                shadowRadius: it.shadowRadius ?? null,
                shadowStrength: it.shadowStrength ?? null,

                mesh
            });
            newIds.push(id);
        }

        const g = { id: crypto.randomUUID(), members: newIds.slice().sort() };
        state.groups.push(g);
        ensureGroupNode(g);

        state.selectedRefId = null;
        state.selectedIds.clear();
        for (const id of g.members) state.selectedIds.add(id);

        rebuildSelectionRig();
        updateXformPanelState();
        state.api.pushHistory?.("paste-group");
    }

    async function pasteMultiFromClipboard(offset = true) {
        if (!state.multiClipboard) return;

        const newIds = [];

        for (const item of state.multiClipboard.items) {
            const mesh = await makeCubeForBlock(
                state,
                item.blockName,
                item.properties ?? null
            );

            const m = new THREE.Matrix4().fromArray(item.mat);

            if (offset) {
                m.premultiply(new THREE.Matrix4().makeTranslation(1, 0, 0));
            }

            state.scene.add(mesh);
            setObjectWorldMatrix(mesh, m);

            const id = crypto.randomUUID();

            state.entities.push({
                id,
                blockName: item.blockName,
                properties: item.properties ?? null,
                tags: Array.isArray(item.tags) ? [...item.tags] : [],
                viewRange: item.viewRange ?? null,
                brightness: item.brightness ?? null,
                shadowRadius: item.shadowRadius ?? null,
                shadowStrength: item.shadowStrength ?? null,
                mesh
            });

            newIds.push(id);
        }

        // select pasted set (UNGROUPED)
        state.selectedIds.clear();
        for (const id of newIds) state.selectedIds.add(id);

        state.selectedRefId = null;

        rebuildSelectionRig();

        state.api.pushHistory?.("paste-multi");
    }



    // ---- placement ----
    async function placeAt(point, { selectAfter = true } = {}) {
        const blockName = state.ui.paletteValue;
        if (!blockName) return;

        const properties = getDefaultPropertiesForBlock(blockName)
        const mesh = await makeCubeForBlock(state, blockName, properties);

        const world = computeGroundPlacementWorld(point);

        state.scene.add(mesh);
        setObjectWorldMatrix(mesh, world);

        const id = crypto.randomUUID();
        state.entities.push({
            id,
            blockName,
            properties,

            tags: [],
            viewRange: null,
            brightness: null,
            shadowRadius: null,
            shadowStrength: null,

            mesh
        });

        if (selectAfter) {
            state.selectedRefId = null;
            state.selectedIds.clear();
            state.selectedIds.add(id);
            rebuildSelectionRig();
        } else {
            state.api.updateHighlight?.();
        }

        state.api.pushHistory?.("place");
    }

    function snapToStep(v, step = state.const.TRANS_SNAP) {
        return Math.round(v / step) * step;
    }

    function getWorldFaceNormal(hit) {
        const n = hit.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);

        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        n.applyMatrix3(normalMatrix).normalize();

        // Snap near-cardinal normals to exact axes.
        const ax = Math.abs(n.x);
        const ay = Math.abs(n.y);
        const az = Math.abs(n.z);

        if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(n.x) || 1, 0, 0);
        if (ay >= ax && ay >= az) return new THREE.Vector3(0, Math.sign(n.y) || 1, 0);
        return new THREE.Vector3(0, 0, Math.sign(n.z) || 1);
    }

    function getColliderProjectionRange(root, normal) {
        root.updateMatrixWorld(true);

        const boxes = root.userData?.colliderBoxes;
        const points = [];

        if (Array.isArray(boxes) && boxes.length) {
            for (const box of boxes) {
                const min = new THREE.Vector3().fromArray(box.min);
                const max = new THREE.Vector3().fromArray(box.max);

                for (const x of [min.x, max.x]) {
                    for (const y of [min.y, max.y]) {
                        for (const z of [min.z, max.z]) {
                            points.push(
                                new THREE.Vector3(x, y, z).applyMatrix4(root.matrixWorld)
                            );
                        }
                    }
                }
            }
        } else {
            const bb = new THREE.Box3().setFromObject(root);
            for (const x of [bb.min.x, bb.max.x]) {
                for (const y of [bb.min.y, bb.max.y]) {
                    for (const z of [bb.min.z, bb.max.z]) {
                        points.push(new THREE.Vector3(x, y, z));
                    }
                }
            }
        }

        let minProj = Infinity;
        let maxProj = -Infinity;

        for (const p of points) {
            const d = p.dot(normal);
            minProj = Math.min(minProj, d);
            maxProj = Math.max(maxProj, d);
        }

        return { min: minProj, max: maxProj };
    }

    function getPlacementRootFromHit(hit) {
        const ent = entityByObject(hit.object);
        if (ent) return ent.mesh;

        const ref = refByObject(hit.object);
        if (ref) return ref.root;

        return hit.object;
    }

    async function placeFlushAtHit(hit, { selectAfter = false } = {}) {
        const blockName = state.ui.paletteValue;
        if (!blockName || !hit) return;

        const properties = getDefaultPropertiesForBlock(blockName);
        const mesh = await makeCubeForBlock(state, blockName, properties);

        state.scene.add(mesh);

        const world = computeFlushPlacementWorld(hit, mesh);
        setObjectWorldMatrix(mesh, world);

        const id = crypto.randomUUID();
        state.entities.push({
            id,
            blockName,
            properties,

            tags: [],
            viewRange: null,
            brightness: null,
            shadowRadius: null,
            shadowStrength: null,

            mesh
        });

        if (selectAfter) {
            state.selectedRefId = null;
            state.selectedIds.clear();
            state.selectedIds.add(id);
            rebuildSelectionRig();
        } else {
            state.api.updateHighlight?.();
        }

        state.api.pushHistory?.("flush-place");
    }

    function makePreviewMaterial(mat) {
        const clone = mat.clone();

        clone.transparent = true;
        clone.opacity = 0.35;

        clone.depthWrite = false;
        clone.depthTest = true;
        clone.side = THREE.DoubleSide;

        clone.alphaTest = 0.01;
        clone.blending = THREE.NormalBlending;
        clone.forceSinglePass = true;

        // Shader/special materials like end_gateway/end_portal may use uniforms.
        // Preserve the shader, but try to lower any opacity-like uniform.
        if (clone.uniforms) {
            for (const key of ["opacity", "alpha", "uOpacity", "uAlpha"]) {
                if (clone.uniforms[key]) {
                    clone.uniforms[key].value = 0.35;
                }
            }
        }

        clone.needsUpdate = true;
        return clone;
    }

    function makeGhostObject(root) {
        root.traverse((o) => {
            if (o.isMesh) {
                o.visible = true;
                o.frustumCulled = false;

                if (Array.isArray(o.material)) {
                    o.material = o.material.map(makePreviewMaterial);
                } else if (o.material) {
                    o.material = makePreviewMaterial(o.material);
                }

                o.renderOrder = 999;
                o.userData.isPlacementPreview = true;
            }
        });

        root.userData.isPlacementPreview = true;
        root.visible = false;

        return root;
    }

    async function ensurePlacementPreview(blockName) {
        if (!blockName) return null;

        if (placementPreviewMesh && placementPreviewBlockName === blockName) {
            return placementPreviewMesh;
        }

        if (
            placementPreviewPromise &&
            placementPreviewPromiseBlockName === blockName
        ) {
            return await placementPreviewPromise;
        }

        hidePlacementPreview();

        const token = ++placementPreviewBuildToken;
        placementPreviewPromiseBlockName = blockName;

        placementPreviewPromise = (async () => {
            const properties = getDefaultPropertiesForBlock(blockName);
            const mesh = await makeCubeForBlock(state, blockName, properties);

            if (token !== placementPreviewBuildToken) {
                return null;
            }

            placementPreviewMesh = makeGhostObject(mesh);
            placementPreviewBlockName = blockName;

            state.scene.add(placementPreviewMesh);

            return placementPreviewMesh;
        })();

        const result = await placementPreviewPromise;

        if (placementPreviewPromiseBlockName === blockName) {
            placementPreviewPromise = null;
            placementPreviewPromiseBlockName = null;
        }

        return result;
    }

    function hidePlacementPreview() {
        placementPreviewBuildToken++;

        placementPreviewPromise = null;
        placementPreviewPromiseBlockName = null;

        if (placementPreviewMesh) {
            if (placementPreviewMesh.parent) {
                placementPreviewMesh.parent.remove(placementPreviewMesh);
            }

            placementPreviewMesh = null;
            placementPreviewBlockName = null;
        }
    }

    function computeGroundPlacementWorld(point) {
        const snap = (v) => Math.round(v / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;

        const pos = new THREE.Vector3(
            snap(point.x),
            snap(point.y + 0.5),
            snap(point.z)
        );

        const quat = new THREE.Quaternion();
        const sca = new THREE.Vector3(1, 1, 1);

        return new THREE.Matrix4().compose(pos, quat, sca);
    }

    function computeFlushPlacementWorld(hit, mesh) {
        const targetRoot = getPlacementRootFromHit(hit);
        const normal = getWorldFaceNormal(hit);

        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3(1, 1, 1);

        const startPos = new THREE.Vector3(
            snapToStep(hit.point.x),
            snapToStep(hit.point.y),
            snapToStep(hit.point.z)
        );

        let world = new THREE.Matrix4().compose(startPos, quat, scale);
        setObjectWorldMatrix(mesh, world);

        targetRoot.updateMatrixWorld(true);
        mesh.updateMatrixWorld(true);

        const targetRange = getColliderProjectionRange(targetRoot, normal);
        const newRange = getColliderProjectionRange(mesh, normal);

        const shift = targetRange.max - newRange.min;
        const finalPos = startPos.clone().addScaledVector(normal, shift);

        return new THREE.Matrix4().compose(finalPos, quat, scale);
    }

    async function updatePlacementPreview(e) {
        const blockName = state.ui.paletteValue;

        if (!blockName || state.api.transform?.dragging || state.isTransforming) {
            hidePlacementPreview();
            return;
        }

        const shouldPreview = placementAltHeld || collPlacementKeyHeld;

        if (!shouldPreview) {
            hidePlacementPreview();
            return;
        }

        const preview = await ensurePlacementPreview(blockName);
        if (!preview) return;

        // Temporarily hide preview so it cannot affect picking/fallbacks.
        preview.visible = false;

        const hit = pickAnyHit(e);

        let world = null;

        if (collPlacementKeyHeld && hit) {
            world = computeFlushPlacementWorld(hit, preview);
        } else {
            world = computeGroundPlacementWorld(getGroundPoint(e));
        }

        setObjectWorldMatrix(preview, world);
        preview.visible = true;
    }

    // ---- picking refs ----
    function refByObject(obj) {
        let p = obj;
        while (p) {
            const found = state.refs.find((r) => r.root === p);
            if (found) return found;
            p = p.parent;
        }
        return null;
    }

    function pickAnyHit(e) {
        screenToRay(e);

        const blockHits = raycaster.intersectObjects(
            state.entities.map((x) => x.mesh),
            true
        );

        const refRoots = state.refs.map((r) => r.root);
        const refHits = raycaster.intersectObjects(refRoots, true);

        const best = [...blockHits, ...refHits].sort((a, b) => a.distance - b.distance)[0] || null;
        return best;
    }

    // ---- interaction state for drags ----
    const dragOffset = new THREE.Vector3();
    const refDragOffset = new THREE.Vector3();
    const dragStartRigPos = new THREE.Vector3();
    const dragStartRefPos = new THREE.Vector3();
    const dragLastRigPos = new THREE.Vector3();
    const dragStartPointerPoint = new THREE.Vector3();
    const refDragStartPointerPoint = new THREE.Vector3();
    let placementPreviewMesh = null;
    let placementPreviewBlockName = null;
    let placementPreviewBuildToken = 0;
    let placementPreviewPromise = null;
    let placementPreviewPromiseBlockName = null;
    let lastPointerEvent = null;
    let placementAltHeld = false;
    let collPlacementKeyHeld = false;

    function isCollisionKey(e) {
        return e.key === "c" || e.key === "C";
    }

    function isCollPlacementKey(e) {
        return e.key === "x" || e.key === "X";
    }

    function applyRigPlaneDragPosition(rig, targetPos) {
        const desiredDelta = targetPos.clone().sub(rig.position);

        if (state.collisionHeld) {
            const allowedDelta = resolveSelectionMoveDelta(state, desiredDelta);
            rig.position.add(allowedDelta);
        } else {
            rig.position.copy(targetPos);
        }

        rig.updateMatrixWorld(true);
        dragLastRigPos.copy(rig.position);
    }

    // ---- pointer handlers ----
    window.addEventListener("pointerdown", async (e) => {
        if (modalOpen()) return;
        if (state.isRestoringHistory) return;
        if (e.target.closest("#ui")) return;
        if (e.target.closest("#xformUI")) return;
        lastPointerEvent = e;

        // Alt+Click place
        if ((e.altKey || placementAltHeld) && e.button === 0 && !state.api.transform?.dragging && !state.isTransforming) {
            hidePlacementPreview();
            await placeAt(getGroundPoint(e));
            return;
        }

        if (state.api.transform?.dragging || state.isTransforming) return;
        if (e.button !== 0) return;

        const hit = pickAnyHit(e);
        // X+Click placement:
        // - if clicking an object face: place flush against that face
        // - if clicking empty/grid floor: place on the floor
        // - do NOT auto-select the newly placed block
        if (
            collPlacementKeyHeld &&
            e.button === 0 &&
            state.ui.paletteValue &&
            !state.api.transform?.dragging &&
            !state.isTransforming
        ) {
            hidePlacementPreview();

            if (hit) {
                await placeFlushAtHit(hit, { selectAfter: false });
            } else {
                await placeAt(getGroundPoint(e), { selectAfter: false });
            }
            return;
        }

        // --- clicked a ref? ---
        if (hit) {
            const ref = refByObject(hit.object);
            if (ref) {
                if (state.selectedRefId !== ref.id) {
                    clearSelection({ keepUI: true });
                    selectReference(ref);
                } else {
                    // camera-relative plane drag ref
                    dragStartRefPos.copy(ref.root.position);
                    refDragStartPointerPoint.copy(beginCameraRelativeDragPlane(e, dragStartRefPos));

                    state.isDraggingRef = true;
                    updateOrbitEnabled();
                }
                return;
            }
        }

        // --- empty space ---
        if (!hit) {
            if (e.ctrlKey) {
                // start box select blocks only
                state.boxSelecting = true;
                state.boxStart = { x: e.clientX, y: e.clientY };
                selBox.style.left = `${state.boxStart.x}px`;
                selBox.style.top = `${state.boxStart.y}px`;
                selBox.style.width = `0px`;
                selBox.style.height = `0px`;
                selBox.style.display = "block";
                state.orbit.enabled = false;
                return;
            }

            clearSelection();
            return;
        }

        // --- clicked a block ---
        state.selectedRefId = null;

        const ent = entityByObject(hit.object);
        if (!ent) return;



        if (e.ctrlKey) {
            if (state.selectedIds.has(ent.id)) state.selectedIds.delete(ent.id);
            else state.selectedIds.add(ent.id);

            rebuildSelectionRig();
            updateXformPanelState();
            return;
        }

        if (!state.selectedIds.has(ent.id)) {
            const g = groupForMember(ent.id);
            if (g) {
                state.selectedIds.clear();
                for (const mid of g.members) state.selectedIds.add(mid);
            } else {
                state.selectedIds.clear();
                state.selectedIds.add(ent.id);
            }
            rebuildSelectionRig();
        } else {
            // start camera-relative plane drag
            const rig = state.activeRig || state.selectionRig;

            dragStartRigPos.copy(rig.position);
            dragLastRigPos.copy(rig.position);
            dragStartPointerPoint.copy(beginCameraRelativeDragPlane(e, hit.point));
            dragOffset.copy(rig.position).sub(dragStartPointerPoint);

            state.isDraggingMesh = true;
            updateOrbitEnabled();
        }
    });

    window.addEventListener("pointermove", (e) => {
        if (modalOpen()) return;
        if (state.isRestoringHistory) return;
        lastPointerEvent = e;
        void updatePlacementPreview(e);
        if (state.boxSelecting) {
            const x1 = Math.min(state.boxStart.x, e.clientX);
            const y1 = Math.min(state.boxStart.y, e.clientY);
            const x2 = Math.max(state.boxStart.x, e.clientX);
            const y2 = Math.max(state.boxStart.y, e.clientY);

            selBox.style.left = `${x1}px`;
            selBox.style.top = `${y1}px`;
            selBox.style.width = `${x2 - x1}px`;
            selBox.style.height = `${y2 - y1}px`;
            return;
        }

        if (state.api.transform?.dragging || state.isTransforming) return;

        // drag ref on plane
        if (state.isDraggingRef && state.selectedRefId) {
            const gp = dragStartRefPos.clone().add(
                getCameraRelativeDragPoint(e).sub(refDragStartPointerPoint)
            );

            const r = state.refs.find((x) => x.id === state.selectedRefId);
            if (r) {
                const targetPos = gp.clone();

                if (e.shiftKey) {
                    targetPos.x = dragStartRefPos.x + Math.round((targetPos.x - dragStartRefPos.x) / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;
                    targetPos.y = dragStartRefPos.y + Math.round((targetPos.y - dragStartRefPos.y) / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;
                    targetPos.z = dragStartRefPos.z + Math.round((targetPos.z - dragStartRefPos.z) / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;
                }

                r.root.position.copy(targetPos);

                state.api.fillTransformUI?.(r.root);
                shadow.visible = true;
                shadow.position.set(r.root.position.x, 0.002, r.root.position.z);
            }
        }

        // drag blocks on camera-relative plane
        if (!state.isDraggingMesh) return;
        if (state.selectedIds.size === 0) return;

        const p = getCameraRelativeDragPoint(e);
        const rig = state.activeRig || state.selectionRig;

        const targetPos = p.clone().add(dragOffset);

        if (e.shiftKey) {
            targetPos.x = dragStartRigPos.x + Math.round((targetPos.x - dragStartRigPos.x) / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;
            targetPos.y = dragStartRigPos.y + Math.round((targetPos.y - dragStartRigPos.y) / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;
            targetPos.z = dragStartRigPos.z + Math.round((targetPos.z - dragStartRigPos.z) / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;
        }

        if (typeof applyRigPlaneDragPosition === "function") {
            applyRigPlaneDragPosition(rig, targetPos);
        } else {
            rig.position.copy(targetPos);
            rig.updateMatrixWorld(true);
        }

        if (state.selectedIds.size === 1) {
            const m = getOnlySelectedMesh();
            if (m) state.api.fillTransformUI?.(m);
        }
    });

    window.addEventListener("pointerup", () => {
        if (modalOpen()) return;
        if (state.isRestoringHistory) return;
        if (!state.collisionHeld) {
            hidePlacementPreview();
        }
        if (state.boxSelecting) {
            state.boxSelecting = false;
            selBox.style.display = "none";
            state.orbit.enabled = true;

            const x1 = parseFloat(selBox.style.left);
            const y1 = parseFloat(selBox.style.top);
            const x2 = x1 + parseFloat(selBox.style.width);
            const y2 = y1 + parseFloat(selBox.style.height);

            const w = x2 - x1;
            const h = y2 - y1;
            if (w < 6 && h < 6) return;

            const picked = [];
            const center = new THREE.Vector3();

            for (const ent of state.entities) {
                new THREE.Box3().setFromObject(ent.mesh).getCenter(center);
                const s = worldToScreen(center);

                if (s.ndcZ < -1 || s.ndcZ > 1) continue;

                if (s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2) picked.push(ent.id);
            }

            state.selectedRefId = null;
            state.selectedIds.clear();
            for (const id of picked) state.selectedIds.add(id);

            rebuildSelectionRig();
            updateXformPanelState();
            return;
        }

        const wasRef = state.isDraggingRef;
        state.isDraggingRef = false;

        const was = state.isDraggingMesh;
        state.isDraggingMesh = false;
        updateOrbitEnabled();

        if (wasRef) {
            state.api.pushHistory?.("ref-plane-drag");
            return;
        }

        if (was && state.selectedIds.size > 0) {
            bakeRigToMeshes();
            rebuildSelectionRig();
            state.api.pushHistory?.("plane-drag");
        }
    });

    window.addEventListener("pointercancel", () => {
        if (modalOpen()) return;
        if (state.isRestoringHistory) return;
        hidePlacementPreview();
        state.isDraggingMesh = false;
        state.isDraggingRef = false;
        updateOrbitEnabled();
    });

    // ---- keyboard (group / ungroup / delete / undo / redo) ----
    window.addEventListener("keydown", (e) => {
        if (modalOpen()) return;
        if (state.isRestoringHistory) return;
        if (isTextInputFocused()) return;
        if (isCollisionKey(e)) {
            if (!state.collisionHeld) {
                state.collisionHeld = true;
                if (lastPointerEvent) void updatePlacementPreview(lastPointerEvent);
            }
        }
        if (isCollPlacementKey(e)) {
            if (!collPlacementKeyHeld) {
                collPlacementKeyHeld = true;
                if (lastPointerEvent) void updatePlacementPreview(lastPointerEvent);
            }
        }
        const isMac = navigator.platform.toLowerCase().includes("mac");
        const mod = isMac ? e.metaKey : e.ctrlKey;

        if (e.key === "Alt") {
            e.preventDefault();

            if (!placementAltHeld) {
                placementAltHeld = true;
                if (lastPointerEvent) void updatePlacementPreview(lastPointerEvent);
            }
        }

        if (e.altKey) {
            e.preventDefault();
        }

        // undo / redo
        if (mod && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
        }
        if (mod && e.key.toLowerCase() === "y") {
            e.preventDefault();
            redo();
            return;
        }

        // group / ungroup
        if (e.key === "g" || e.key === "G") {
            groupSelected();
            return;
        }
        if (e.key === "u" || e.key === "U") {
            ungroupSelection();
            return;
        }

        // delete
        if (e.key === "Delete") {
            if (state.selectedRefId) {
                const idx = state.refs.findIndex((r) => r.id === state.selectedRefId);
                if (idx !== -1) {
                    const r = state.refs[idx];
                    state.scene.remove(r.root);
                    state.refs.splice(idx, 1);
                }
                state.selectedRefId = null;
                state.api.transform?.detach();
                state.activeRig = null;
                shadow.visible = false;
                state.api.pushHistory?.("delete-ref");
                updateHighlight();
                updateXformPanelState();
                return;
            }

            if (state.selectedIds.size > 0) {
                const toDelete = [...state.selectedIds];
                clearSelection({ keepUI: true });

                for (const id of toDelete) {
                    const idx = state.entities.findIndex((x) => x.id === id);
                    if (idx === -1) continue;

                    const mesh = state.entities[idx].mesh;
                    if (mesh.parent) mesh.parent.remove(mesh);
                    else state.scene.remove(mesh);

                    state.entities.splice(idx, 1);

                    for (const g of state.groups) {
                        const mi = g.members.indexOf(id);
                        if (mi !== -1) g.members.splice(mi, 1);
                    }
                }

                // cleanup empty/singleton groups
                for (let gi = state.groups.length - 1; gi >= 0; gi--) {
                    const g = state.groups[gi];
                    const node = state.groupNodes.get(g.id);

                    if (g.members.length === 0) {
                        if (node && node.parent) node.parent.remove(node);
                        state.groupNodes.delete(g.id);
                        state.groups.splice(gi, 1);
                        continue;
                    }

                    if (g.members.length === 1) {
                        const remainingId = g.members[0];
                        const ent = state.entities.find((x) => x.id === remainingId);
                        if (ent && node) attachKeepWorldMatrix(ent.mesh, state.scene);
                        if (node && node.parent) node.parent.remove(node);
                        state.groupNodes.delete(g.id);
                        state.groups.splice(gi, 1);
                    }
                }

                clearSelection();
                state.api.pushHistory?.("delete");
                return;
            }
        }
    });

    window.addEventListener("keyup", (e) => {
        if (isCollisionKey(e)) {
            state.collisionHeld = false;
        }
        if (isCollPlacementKey(e)) {
            collPlacementKeyHeld = false;
        }
        if (e.key === "Alt") {
            e.preventDefault();
            placementAltHeld = false;
        }

        if (!collPlacementKeyHeld && !placementAltHeld) {
            hidePlacementPreview();
        }
    })

    // ---- history snapshots ----
    function takeSnapshot() {
        return {
            entities: state.entities.map((e) => {
                e.mesh.updateMatrixWorld(true);
                return {
                    id: e.id,
                    blockName: e.blockName,
                    properties: e.properties ?? null,
                    tags: Array.isArray(e.tags) ? [...e.tags] : [],
                    viewRange: e.viewRange ?? null,
                    brightness: e.brightness ?? null,
                    shadowRadius: e.shadowRadius ?? null,
                    shadowStrength: e.shadowStrength ?? null,
                    mat: e.mesh.matrixWorld.elements.slice()
                };
            }),
            groups: structuredClone(state.groups),
            refs: state.refs.map(r => {
                r.root.updateMatrixWorld(true);
                return {
                    id: r.id,
                    name: r.name,
                    kind: r.kind,
                    assetId: r.assetId,
                    mat: r.root.matrixWorld.elements.slice(),
                };
            }),
            selectedRefId: state.selectedRefId,
            selected: [...state.selectedIds],
        };
    }

    async function restoreSnapshot(snap) {
        emptySelectionRig();
        state.api.transform?.detach();

        // (optional but recommended) stop any drags so orbit/controls don't get stuck
        state.isDraggingMesh = false;
        state.isDraggingRef = false;
        state.isTransforming = false;

        for (const [, node] of state.groupNodes) state.scene.remove(node);
        state.groupNodes.clear();

        for (const e of state.entities) state.scene.remove(e.mesh);
        state.entities.length = 0;

        for (const se of snap.entities) {
            const mesh = await makeCubeForBlock(state, se.blockName, se.properties ?? null);
            state.scene.add(mesh);
            setObjectWorldMatrix(mesh, new THREE.Matrix4().fromArray(se.mat));
            state.entities.push({
                id: se.id,
                blockName: se.blockName,
                properties: se.properties ?? null,

                tags: Array.isArray(se.tags) ? [...se.tags] : [],
                viewRange: se.viewRange ?? null,
                brightness: se.brightness ?? null,
                shadowRadius: se.shadowRadius ?? null,
                shadowStrength: se.shadowStrength ?? null,

                mesh
            });
        }

        state.groups.length = 0;
        for (const g of snap.groups) state.groups.push(g);
        for (const g of state.groups) ensureGroupNode(g);

        // restore block selection set
        state.selectedIds.clear();
        for (const id of snap.selected) state.selectedIds.add(id);

        // ---------------------------
        // ✅ NEW: restore ref selection id FIRST
        // ---------------------------
        state.selectedRefId = snap.selectedRefId || null;

        // ---------------------------
        // restore refs (you rebuild them from assets)
        // ---------------------------
        for (const r of state.refs) state.scene.remove(r.root);
        state.refs.length = 0;

        for (const sr of snap.refs || []) {
            const root = state.api.instantiateRefFromAsset?.(sr.assetId);
            if (!root) continue;

            root.userData.kind = "ref";
            root.userData.exportable = false;

            state.scene.add(root);

            const ref = {
                id: sr.id,
                name: sr.name || "ref",
                kind: sr.kind,
                assetId: sr.assetId,
                root,
                url: null,
            };
            state.refs.push(ref);

            setObjectWorldTRS(root, new THREE.Matrix4().fromArray(sr.mat));
        }

        // ---------------------------
        // ✅ NEW: if a ref is selected in the snapshot,
        // select it + attach transform, then RETURN.
        // This prevents rebuildSelectionRig() from clobbering the ref selection.
        // ---------------------------
        if (state.selectedRefId) {
            const ref = state.refs.find(r => r.id === state.selectedRefId);
            if (ref) {
                // clear block selection rig but keep UI alive
                state.selectedIds.clear();
                // this must set activeRig = ref.root, attach transform, show UI, outline, etc.
                state.api.selectReference?.(ref);

                updateXformPanelState();
                updateOrbitEnabled();
                return; // ✅ CRITICAL
            } else {
                state.selectedRefId = null;
            }
        }

        // No ref selected -> normal block selection restore
        rebuildSelectionRig();
        updateXformPanelState();
        updateOrbitEnabled();
    }


    function pushHistory() {
        state.history.splice(state.historyIndex + 1);
        state.history.push(takeSnapshot());

        if (state.history.length > state.const.HISTORY_MAX) state.history.shift();
        state.historyIndex = state.history.length - 1;
    }

    async function undo() {
        if (state.historyIndex <= 0) return;
        if (state.isRestoringHistory) return;

        state.isRestoringHistory = true;
        try {
            state.historyIndex--;
            await restoreSnapshot(state.history[state.historyIndex]);
        } finally {
            state.isRestoringHistory = false;
        }
    }

    async function redo() {
        if (state.historyIndex >= state.history.length - 1) return;
        if (state.isRestoringHistory) return;

        state.isRestoringHistory = true;
        try {
            state.historyIndex++;
            await restoreSnapshot(state.history[state.historyIndex]);
        } finally {
            state.isRestoringHistory = false;
        }
    }

    // init snapshot
    pushHistory();

    // ---- wire api exports for other modules ----
    state.api.getGroundPoint = getGroundPoint;
    state.api.placeAt = placeAt;

    state.api.clearSelection = clearSelection;
    state.api.selectReference = selectReference;
    state.api.rebuildSelectionRig = rebuildSelectionRig;

    state.api.emptySelectionRig = emptySelectionRig;
    state.api.bakeRigToMeshes = bakeRigToMeshes;

    state.api.updateHighlight = updateHighlight;
    state.api.updateXformPanelState = updateXformPanelState;

    state.api.getOnlySelectedMesh = getOnlySelectedMesh;
    state.api.serializeSelectedBlock = serializeSelectedBlock;
    state.api.serializeSelectedGroup = serializeSelectedGroup;
    state.api.serializeSelectedMulti = serializeSelectedMulti;
    state.api.pasteBlockFromClipboard = pasteBlockFromClipboard;
    state.api.pasteGroupFromClipboard = pasteGroupFromClipboard;
    state.api.pasteMultiFromClipboard = pasteMultiFromClipboard;

    state.api.groupSelected = groupSelected;
    state.api.ungroupSelection = ungroupSelection;

    state.api.ensureGroupNode = ensureGroupNode;
    state.api.exactGroupForSelection = exactGroupForSelection;

    state.api.stopMeshDrag = stopMeshDrag;
    state.api.stopRefDrag = stopRefDrag;

    state.api.pushHistory = pushHistory;
    state.api.undo = undo;
    state.api.redo = redo;
}

function isTextInputFocused() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = a.tagName ? a.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea") return true;
    if (a.isContentEditable) return true;
    return false;
}
