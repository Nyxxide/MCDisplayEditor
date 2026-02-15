// ImportLogic.js
// --------------
// Handles importing reference models (.glb/.gltf/.obj/.stl) as NON-exportable refs.
// Also provides ref copy/paste (via clipboard) using embedded bytes (Option A).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

import { setObjectWorldTRS } from "./TransformLogic.js";
import { applyReferenceMaterialOverrides } from "./SaveLoadLogic.js"

export function initImportLogic(state) {
    const { importRefBtn, importRefInput } = state.ui;
    if (!importRefBtn || !importRefInput) return;

    const gltfLoader = new GLTFLoader();
    const objLoader = new OBJLoader();
    const stlLoader = new STLLoader();

    importRefBtn.addEventListener("click", () => importRefInput.click());
    importRefInput.addEventListener("change", async () => {
        const f = importRefInput.files?.[0];
        importRefInput.value = "";
        if (!f) return;

        try {
            await addReferenceFromFile(state, f, { gltfLoader, objLoader, stlLoader });
        } catch (err) {
            console.error(err);
            alert("Failed to import reference model (see console).");
        }
    });

    // expose ref clipboard hooks used by TransformLogic hotkeys
    state.api.serializeSelectedRef = () => serializeSelectedRef(state);
    state.api.pasteRefFromClipboard = (offset = true) => pasteRefFromClipboard(state, offset);
}

async function addReferenceFromFile(state, file, loaders) {
    const nameLower = (file.name || "").toLowerCase();
    let kind = null;

    if (nameLower.endsWith(".glb") || nameLower.endsWith(".gltf")) kind = "gltf";
    else if (nameLower.endsWith(".obj")) kind = "obj";
    else if (nameLower.endsWith(".stl")) kind = "stl";
    else throw new Error("Unsupported file type");

    // Option A: embed file bytes for save/load
    const bytes = await file.arrayBuffer();
    const bytesBase64 = arrayBufferToBase64(bytes);

    const assetId = crypto.randomUUID();
    state.refAssets.set(assetId, { kind, name: file.name, bytesBase64, template: null });

    // For immediate import: use blob URL
    const blob = new Blob([bytes], { type: guessMime(kind) });
    const url = URL.createObjectURL(blob);

    const root = await loadRefRoot(kind, url, loaders);
    URL.revokeObjectURL(url);

    // standardize root
    root.name = `ref:${file.name}`;
    root.userData.kind = "ref";
    root.userData.exportable = false;

    // default placement
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);

    applyReferenceMaterialOverrides(root, 0.35);

    const template = root.clone(true);
    template.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const newMats = mats.map((m) => (m?.clone ? m.clone() : m));
        o.material = Array.isArray(o.material) ? newMats : newMats[0];
    });
    state.refAssets.get(assetId).template = template;

    state.scene.add(root);

    const ref = {
        id: crypto.randomUUID(),
        name: file.name,
        kind,
        assetId,
        root,
        url: null,
    };
    state.refs.push(ref);

    // select it
    state.api.clearSelection?.({ keepUI: true });
    state.api.selectReference?.(ref);

    state.api.pushHistory?.("import-ref");
}

function guessMime(kind) {
    if (kind === "gltf") return "model/gltf-binary";
    if (kind === "stl") return "application/sla";
    return "text/plain";
}

function loadRefRoot(kind, url, { gltfLoader, objLoader, stlLoader }) {
    return new Promise((resolve, reject) => {
        if (kind === "gltf") {
            gltfLoader.load(
                url,
                (gltf) => resolve(gltf.scene || gltf.scenes?.[0]),
                undefined,
                reject
            );
            return;
        }

        if (kind === "obj") {
            objLoader.load(url, (obj) => resolve(obj), undefined, reject);
            return;
        }

        if (kind === "stl") {
            stlLoader.load(
                url,
                (geometry) => {
                    geometry.computeVertexNormals();
                    const mat = new THREE.MeshStandardMaterial({
                        color: 0xcccccc,
                        transparent: true,
                        opacity: 0.35,
                        depthWrite: false,
                    });
                    const mesh = new THREE.Mesh(geometry, mat);
                    resolve(mesh);
                },
                undefined,
                reject
            );
            return;
        }

        reject(new Error("Unknown kind"));
    });
}

function serializeSelectedRef(state) {
    if (!state.selectedRefId) return null;
    const r = state.refs.find((x) => x.id === state.selectedRefId);
    if (!r) return null;
    r.root.updateMatrixWorld(true);
    return {
        assetId: r.assetId,
        kind: r.kind,
        mat: r.root.matrixWorld.elements.slice(),
    };
}

async function pasteRefFromClipboard(state, offset = true) {
    if (!state.refClipboard) return;

    const asset = state.refAssets.get(state.refClipboard.assetId);
    if (!asset) return;

    const bytes = base64ToArrayBuffer(asset.bytesBase64);
    const blob = new Blob([bytes], { type: guessMime(asset.kind) });
    const url = URL.createObjectURL(blob);

    const loaders = {
        gltfLoader: new GLTFLoader(),
        objLoader: new OBJLoader(),
        stlLoader: new STLLoader(),
    };

    const root = await loadRefRoot(asset.kind, url, loaders);
    URL.revokeObjectURL(url);

    root.name = `ref:${asset.name}`;
    root.userData.kind = "ref";
    root.userData.exportable = false;

    applyReferenceMaterialOverrides(root, 0.35);

    state.scene.add(root);

    const ref = {
        id: crypto.randomUUID(),
        name: asset.name,
        kind: asset.kind,
        assetId: state.refClipboard.assetId,
        root,
        url: null,
    };
    state.refs.push(ref);

    const m = new THREE.Matrix4().fromArray(state.refClipboard.mat);
    if (offset) m.premultiply(new THREE.Matrix4().makeTranslation(0.25, 0, 0.25));
    setObjectWorldTRS(root, m);

    state.api.clearSelection?.({ keepUI: true });
    state.api.selectReference?.(ref);

    state.api.pushHistory?.("paste-ref");
}

// --- base64 helpers ---
function arrayBufferToBase64(buf) {
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
