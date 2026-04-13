// SaveLoadLogic.js
// ----------------
// Save/Load (merge) with Option A refs: embed ref file bytes in save.
// Also upgrades ref instantiation to be template-based so undo/redo is stable.

import * as THREE from "three";
import { setObjectWorldMatrix } from "../3DEditorSetup/TransformLogic.js";
import { makeCubeForBlock } from "../TextureLoading/TextureLoad.js"

/**
 * Save format:
 * {
 *   version: 1,
 *   entities: [{ id, blockName, properties, brightness, mat:[16] }],
 *   groups: [{ id, members:[entityId...] }],
 *   refAssets: [{ assetId, kind, name, bytesBase64 }],
 *   refs: [{ id, assetId, kind, name, mat:[16] }]
 * }
 */

export function initSaveLoadLogic(state) {
    const uiRoot = document.getElementById("ui");
    if (!uiRoot) return;

    const saveBtn = document.getElementById("saveBtn");
    const loadBtn = document.getElementById("loadBtn");
    const fileInput = document.getElementById("loadInput");

    const saveModal = document.getElementById("saveModal");
    const saveModalClose = document.getElementById("saveModalClose");
    const saveModalConfirm = document.getElementById("saveModalConfirm");
    const saveNameInput = document.getElementById("saveNameInput");

    function openSaveModal() {
        if (!saveModal) return;
        saveModal.style.display = "flex";
        if (state.orbit) state.orbit.enabled = false;

        if (saveNameInput) {
            saveNameInput.value = "display-entity-save";
            requestAnimationFrame(() => {
                saveNameInput.focus();
                saveNameInput.select();
            });
        }
    }

    function closeSaveModal() {
        if (!saveModal) return;
        saveModal.style.display = "none";
        if (state.orbit) state.orbit.enabled = true;
    }

    function confirmSave() {
        const data = buildSaveObject(state);
        const rawName = saveNameInput?.value?.trim() || "display-entity-save";
        const safeName = sanitizeSaveFilename(rawName);
        downloadJson(data, `${safeName}.json`);
        closeSaveModal();
    }

    // --- Actions ---
    saveBtn.addEventListener("click", () => {
        openSaveModal();
    });

    if (saveModalClose) {
        saveModalClose.addEventListener("click", () => {
            closeSaveModal();
        });
    }

    if (saveModalConfirm) {
        saveModalConfirm.addEventListener("click", () => {
            confirmSave();
        });
    }

    if (saveNameInput) {
        saveNameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                confirmSave();
            }
        });
    }

    if (saveModal) {
        saveModal.addEventListener("click", (e) => {
            if (e.target === saveModal) {
                closeSaveModal();
            }
        });
    }

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && saveModal?.style.display !== "none") {
            closeSaveModal();
        }
    });

    loadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
        const f = fileInput.files?.[0];
        fileInput.value = "";
        if (!f) return;
        await loadSaveFileMerge(state, f);
    });

    // expose API hooks if you want to call programmatically
    state.api.saveNow = () => {
        openSaveModal();
    };
    state.api.loadSaveMerge = (file) => loadSaveFileMerge(state, file);

    state.api.instantiateRefFromAsset = (assetId) => instantiateRefFromAsset(state, assetId);
}

/** -------------------- SAVE -------------------- */

function buildSaveObject(state) {
    const entities = state.entities.map((e) => {
        e.mesh.updateMatrixWorld(true);
        return {
            id: e.id,
            blockName: e.blockName,
            properties: e.properties ?? null,
            brightness: e.brightness ?? null,
            mat: e.mesh.matrixWorld.elements.slice(),
        };
    });

    const groups = structuredClone(state.groups);

    const refAssets = [];
    for (const [assetId, a] of state.refAssets.entries()) {
        if (!a?.bytesBase64) continue;
        refAssets.push({
            assetId,
            kind: a.kind,
            name: a.name,
            bytesBase64: a.bytesBase64,
        });
    }

    const refs = state.refs.map((r) => {
        r.root.updateMatrixWorld(true);
        return {
            id: r.id,
            assetId: r.assetId,
            kind: r.kind,
            name: r.name,
            mat: r.root.matrixWorld.elements.slice(),
        };
    });

    return { version: 1, entities, groups, refAssets, refs };
}

function sanitizeSaveFilename(name) {
    return name
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") // illegal filename chars
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\.+$/, "")                    // no trailing dots
        .slice(0, 120) || "display-entity-save";
}

function downloadJson(obj, filename) {
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
}

/** -------------------- LOAD (MERGE) -------------------- */

async function loadSaveFileMerge(state, file) {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data || typeof data !== "object" || data.version !== 1) {
        alert("Unsupported save format.");
        return;
    }

    // 1) Import any missing assets first (and build templates for them)
    if (Array.isArray(data.refAssets)) {
        for (const a of data.refAssets) {
            if (!a?.assetId || !a?.bytesBase64) continue;
            if (!state.refAssets.has(a.assetId)) {
                state.refAssets.set(a.assetId, {
                    kind: a.kind,
                    name: a.name,
                    bytesBase64: a.bytesBase64,
                    template: null, // built below
                });
            }
        }

        // Build templates for assets that don't have one yet
        // This is async but only happens during load, not during undo.
        await buildTemplatesForAllAssets(state);
    }

    // 2) Merge blocks (new ids) and build an id remap for groups
    const idMap = new Map(); // old -> new
    if (Array.isArray(data.entities)) {
        for (const se of data.entities) {
            const newId = crypto.randomUUID();
            idMap.set(se.id, newId);

            const mesh = await makeCubeForBlock(state, se.blockName, se.properties ?? null);
            state.scene.add(mesh);

            const wm = new THREE.Matrix4().fromArray(se.mat);
            setObjectWorldMatrix(mesh, wm);

            state.entities.push({
                id: newId,
                blockName: se.blockName,
                properties: se.properties ?? null,
                brightness: se.brightness ?? null,
                mesh
            });
        }
    }

    // 3) Merge groups (remap member ids)
    if (Array.isArray(data.groups)) {
        for (const g of data.groups) {
            const newMembers = (g.members || [])
                .map((oldId) => idMap.get(oldId))
                .filter(Boolean);

            if (newMembers.length >= 2) {
                state.groups.push({ id: crypto.randomUUID(), members: newMembers });
            }
        }
    }

    // 4) Merge refs (new ids) using asset templates
    if (Array.isArray(data.refs)) {
        for (const rr of data.refs) {
            if (!rr?.assetId) continue;

            const root = instantiateRefFromAsset(state, rr.assetId);
            if (!root) continue;

            // standardize
            root.userData.kind = "ref";
            root.userData.exportable = false;

            state.scene.add(root);

            const ref = {
                id: crypto.randomUUID(),
                name: rr.name || "ref",
                kind: rr.kind || (state.refAssets.get(rr.assetId)?.kind ?? "gltf"),
                assetId: rr.assetId,
                root,
                url: null,
            };
            state.refs.push(ref);

            const wm = new THREE.Matrix4().fromArray(rr.mat);
            setObjectWorldMatrix(root, wm);
        }
    }

    // 5) Rebuild group nodes (so groups behave)
    for (const g of state.groups) state.api.ensureGroupNode?.(g);

    // 6) Keep camera position / selection (you requested that)
    // We'll just refresh selection rig/UI with whatever was currently selected.
    state.api.rebuildSelectionRig?.();
    state.api.updateXformPanelState?.();

    state.api.pushHistory?.("load-merge");
}

/** -------------------- Ref template instantiation -------------------- */

function instantiateRefFromAsset(state, assetId) {
    const asset = state.refAssets.get(assetId);
    if (!asset) return null;

    // template-based (sync) for undo/redo stability
    if (asset.template) {
        const clone = asset.template.clone(true);

        // ensure materials are not shared across instances
        clone.traverse((o) => {
            if (!o.isMesh) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            const newMats = mats.map((m) => (m?.clone ? m.clone() : m));
            o.material = Array.isArray(o.material) ? newMats : newMats[0];
        });

        return clone;
    }

    // If no template exists, we can't sync-instantiate.
    // Load module builds templates first; undo/redo relies on templates.
    console.warn("No template for assetId", assetId);
    return null;
}

/**
 * Build templates for all assets that have bytesBase64 but no template.
 * This is async and should be called during import/load, not undo.
 */
async function buildTemplatesForAllAssets(state) {
    const tasks = [];
    for (const [assetId, asset] of state.refAssets.entries()) {
        if (!asset?.bytesBase64) continue;
        if (asset.template) continue;
        tasks.push(buildTemplateForAsset(state, assetId));
    }
    await Promise.all(tasks);
}

async function buildTemplateForAsset(state, assetId) {
    // We can’t reuse loaders here without importing your import loaders.
    // So we do a dynamic import to avoid circular deps.
    const asset = state.refAssets.get(assetId);
    if (!asset?.bytesBase64) return;

    const { loadRefRootFromBytes } = await import("./LoadModelParse.js");
    const root = await loadRefRootFromBytes(asset.kind, asset.bytesBase64);

    // apply your “ref material” look
    applyReferenceMaterialOverrides(root, 0.35);

    // store template (NOT added to scene)
    asset.template = root;
    state.refAssets.set(assetId, asset);
}

export function applyReferenceMaterialOverrides(root, opacity = 0.35) {
    root.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const newMats = mats.map((m) => {
            if (!m) return m;
            const mm = m.clone();
            mm.transparent = true;
            mm.opacity = opacity;
            mm.depthWrite = false;
            mm.needsUpdate = true;
            return mm;
        });
        o.material = Array.isArray(o.material) ? newMats : newMats[0];
    });
}
