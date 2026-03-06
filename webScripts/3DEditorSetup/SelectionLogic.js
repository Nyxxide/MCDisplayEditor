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

    // --- Raycast + ground plane ---
    const xzPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
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

    function getGroundPoint(e) {
        screenToRay(e);
        const point = new THREE.Vector3();
        raycaster.ray.intersectPlane(xzPlane, point);
        return point;
    }

    function worldToScreen(v3) {
        const v = v3.clone().project(state.camera);
        const x = (v.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
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
            state.selectionBase = (() => {
                const p = new THREE.Vector3();
                const q = new THREE.Quaternion();
                const s = new THREE.Vector3();

                node.updateMatrixWorld(true);
                node.getWorldPosition(p);
                node.getWorldQuaternion(q);

                const sn = node.userData?.scaleNode || node;
                sn.updateMatrixWorld(true);
                sn.getWorldScale(s);

                return { pos: p, quat: q, scale: s };
            })();

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

        if (state.ui.xformHintsEl) {
            const parts = [];
            parts.push("Alt+Click: place");
            parts.push("Shift: snap rotate/scale/translate");
            parts.push("Ctrl+Click: multiselect");
            if (state.selectedIds.size >= 2) parts.push("G: group selected");
            if (state.selectedIds.size > 0 && selectionTouchesAnyGroup()) parts.push("U: ungroup");
            if (groupEdit) parts.push("Group UI shows Δrot + scale ratio");
            if (refEdit) parts.push("Reference object (not exportable)");
            state.ui.xformHintsEl.textContent = parts.join("   |   ");
        }
    }

    function selectionTouchesAnyGroup() {
        if (state.selectedIds.size === 0) return false;
        for (const g of state.groups) {
            for (const id of g.members) {
                if (state.selectedIds.has(id)) return true;
            }
        }
        return false;
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
        return { blockName: ent.blockName, mat: ent.mesh.matrixWorld.elements.slice() };
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
                mat: ent.mesh.matrixWorld.elements.slice(),
            });
        }

        if (!items.length) return null;
        return { items };
    }

    async function pasteBlockFromClipboard(offset = true) {
        if (!state.blockClipboard) return;

        const mesh = await makeCubeForBlock(state, state.blockClipboard.blockName);
        const m = new THREE.Matrix4().fromArray(state.blockClipboard.mat);

        if (offset) m.premultiply(new THREE.Matrix4().makeTranslation(0.25, 0, 0.25));

        state.scene.add(mesh);
        setObjectWorldMatrix(mesh, m);

        const id = crypto.randomUUID();
        state.entities.push({ id, blockName: state.blockClipboard.blockName, mesh });

        state.selectedRefId = null;
        state.selectedIds.clear();
        state.selectedIds.add(id);
        rebuildSelectionRig();

        state.api.pushHistory?.("paste");
    }

    async function pasteGroupFromClipboard(offset = true) {
        if (!state.groupClipboard) return;

        const t = offset
            ? new THREE.Matrix4().makeTranslation(0.25, 0, 0.25)
            : new THREE.Matrix4().identity();

        const newIds = [];

        for (const it of state.groupClipboard.items) {
            const mesh = await makeCubeForBlock(state, it.blockName);
            const m = new THREE.Matrix4().fromArray(it.mat).premultiply(t);

            state.scene.add(mesh);
            setObjectWorldMatrix(mesh, m);

            const id = crypto.randomUUID();
            state.entities.push({ id, blockName: it.blockName, mesh });
            newIds.push(id);
        }

        // ✅ AUTO-GROUP the pasted members
        const g = { id: crypto.randomUUID(), members: newIds.slice().sort() };
        state.groups.push(g);
        ensureGroupNode(g);

        // select the new group
        state.selectedRefId = null;
        state.selectedIds.clear();
        for (const id of g.members) state.selectedIds.add(id);

        rebuildSelectionRig();
        updateXformPanelState();
        state.api.pushHistory?.("paste-group");
    }



    // ---- placement ----
    async function placeAt(point) {
        const blockName = state.ui.paletteValue;
        if(!blockName) return;
        const mesh = await makeCubeForBlock(state, blockName);

        const snap = (v) => Math.round(v / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;
        const pos = new THREE.Vector3(snap(point.x), snap(point.y + 0.5), snap(point.z));
        const quat = new THREE.Quaternion();
        const sca = new THREE.Vector3(1, 1, 1);

        const world = new THREE.Matrix4().compose(pos, quat, sca);

        state.scene.add(mesh);
        setObjectWorldMatrix(mesh, world);

        const id = crypto.randomUUID();
        state.entities.push({ id, blockName, mesh });

        state.selectedRefId = null;
        state.selectedIds.clear();
        state.selectedIds.add(id);
        rebuildSelectionRig();

        state.api.pushHistory?.("place");
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

    // ---- pointer handlers ----
    window.addEventListener("pointerdown", (e) => {
        if (e.target.closest("#ui")) return;
        if (e.target.closest("#xformUI")) return;

        // Alt+Click place
        if (e.altKey && e.button === 0 && !state.api.transform?.dragging && !state.isTransforming) {
            placeAt(getGroundPoint(e));
            return;
        }

        if (state.api.transform?.dragging || state.isTransforming) return;
        if (e.button !== 0) return;

        const hit = pickAnyHit(e);

        // --- clicked a ref? ---
        if (hit) {
            const ref = refByObject(hit.object);
            if (ref) {
                if (state.selectedRefId !== ref.id) {
                    clearSelection({ keepUI: true });
                    selectReference(ref);
                } else {
                    // plane drag ref
                    const gp = getGroundPoint(e);
                    refDragOffset.copy(ref.root.position).sub(gp);
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
            // start plane drag
            const gp = getGroundPoint(e);
            const rig = state.activeRig || state.selectionRig;
            dragOffset.copy(rig.position).sub(gp);
            state.isDraggingMesh = true;
            updateOrbitEnabled();
        }
    });

    window.addEventListener("pointermove", (e) => {
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
            const gp = getGroundPoint(e).add(refDragOffset);
            const snap = (v) => Math.round(v / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;

            const r = state.refs.find((x) => x.id === state.selectedRefId);
            if (r) {
                r.root.position.set(snap(gp.x), r.root.position.y, snap(gp.z));
                state.api.fillTransformUI?.(r.root);
                shadow.visible = true;
                shadow.position.set(r.root.position.x, 0.002, r.root.position.z);
            }
            return;
        }

        // drag blocks on plane
        if (!state.isDraggingMesh) return;
        if (state.selectedIds.size === 0) return;

        const p = getGroundPoint(e).add(dragOffset);
        const snap = (v) => Math.round(v / state.const.TRANS_SNAP) * state.const.TRANS_SNAP;

        const rig = state.activeRig || state.selectionRig;
        rig.position.set(snap(p.x), rig.position.y, snap(p.z));

        if (state.selectedIds.size === 1) {
            const m = getOnlySelectedMesh();
            if (m) state.api.fillTransformUI?.(m);
        }
    });

    window.addEventListener("pointerup", () => {
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
        state.isDraggingMesh = false;
        state.isDraggingRef = false;
        updateOrbitEnabled();
    });

    // ---- keyboard (group / ungroup / delete / undo / redo) ----
    window.addEventListener("keydown", (e) => {
        const isMac = navigator.platform.toLowerCase().includes("mac");
        const mod = isMac ? e.metaKey : e.ctrlKey;

        if (isTextInputFocused()) return;

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

    // ---- history snapshots ----
    function takeSnapshot() {
        return {
            entities: state.entities.map((e) => {
                e.mesh.updateMatrixWorld(true);
                return { id: e.id, blockName: e.blockName, mat: e.mesh.matrixWorld.elements.slice() };
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
            const mesh = await makeCubeForBlock(state, se.blockName);
            state.scene.add(mesh);
            setObjectWorldMatrix(mesh, new THREE.Matrix4().fromArray(se.mat));
            state.entities.push({ id: se.id, blockName: se.blockName, mesh });
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

    function undo() {
        if (state.historyIndex <= 0) return;
        state.historyIndex--;
        restoreSnapshot(state.history[state.historyIndex]);
    }

    function redo() {
        if (state.historyIndex >= state.history.length - 1) return;
        state.historyIndex++;
        restoreSnapshot(state.history[state.historyIndex]);
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
    state.api.pasteBlockFromClipboard = pasteBlockFromClipboard;
    state.api.pasteGroupFromClipboard = pasteGroupFromClipboard;

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
