// SaveLoadRefParse.js
// -------------------
// Async parsing of embedded ref bytes into a THREE.Object3D root.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

export async function loadRefRootFromBytes(kind, bytesBase64) {
    const bytes = base64ToArrayBuffer(bytesBase64);
    const blob = new Blob([bytes], { type: guessMime(kind) });
    const url = URL.createObjectURL(blob);

    try {
        const root = await loadRefRoot(kind, url);
        return root;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function guessMime(kind) {
    if (kind === "gltf") return "model/gltf-binary";
    if (kind === "stl") return "application/sla";
    return "text/plain";
}

function loadRefRoot(kind, url) {
    return new Promise((resolve, reject) => {
        if (kind === "gltf") {
            const gltfLoader = new GLTFLoader();
            gltfLoader.load(url, (gltf) => resolve(gltf.scene || gltf.scenes?.[0]), undefined, reject);
            return;
        }

        if (kind === "obj") {
            const objLoader = new OBJLoader();
            objLoader.load(url, (obj) => resolve(obj), undefined, reject);
            return;
        }

        if (kind === "stl") {
            const stlLoader = new STLLoader();
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
                    resolve(new THREE.Mesh(geometry, mat));
                },
                undefined,
                reject
            );
            return;
        }

        reject(new Error("Unknown ref kind: " + kind));
    });
}

function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
