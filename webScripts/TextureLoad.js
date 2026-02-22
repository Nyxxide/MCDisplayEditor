import * as THREE from "three";

export async function loadAtlas(atlasPngUrl, atlasJsonUrl) {
    const [atlasMeta, atlasTex] = await Promise.all([
        fetch(atlasJsonUrl).then(r => r.json()),
        loadAtlasTexture(atlasPngUrl),
    ]);

    return { atlasMeta, atlasTex };
}

async function loadAtlasTexture(url) {
    const loader = new THREE.ImageBitmapLoader();
    const bitmap = await loader.loadAsync(url);

    const tex = new THREE.Texture(bitmap);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace; // ✅ IMPORTANT for correct colors
    tex.needsUpdate = true;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;


    return tex;
}

// --- Colormap loading (grass/foliage) ---
let _colormapsPromise = null;
let _foliageMap = null; // { data: Uint8ClampedArray, w, h }
let _grassMap = null;

async function loadColormapsOnce() {
    if (_colormapsPromise) return _colormapsPromise;

    _colormapsPromise = (async () => {
        _foliageMap = await loadColormap("../Resources/textures/colormap/foliage.png");
        _grassMap   = await loadColormap("../Resources/textures/colormap/grass.png");
    })();

    return _colormapsPromise;
}

async function loadColormap(url) {
    const loader = new THREE.ImageBitmapLoader();
    const bmp = await loader.loadAsync(url);

    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);

    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { data: img.data, w: bmp.width, h: bmp.height };
}


export function rectToUVs(rect, atlasW, atlasH) {
    const u0 = rect.x / atlasW;
    const v0 = rect.y / atlasH;
    const u1 = (rect.x + rect.w) / atlasW;
    const v1 = (rect.y + rect.h) / atlasH;
    return { u0, v0, u1, v1 };
}


export function makeTexturedCube(atlas, texId) {
    const { atlasMeta, atlasTex } = atlas;
    const entry = atlasMeta.textures[texId];
    if (!entry) return null;

    const { u0, v0, u1, v1 } = rectToUVs(entry, atlasMeta.atlasW, atlasMeta.atlasH);

    const geom = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

    // ✅ apply same tile to all faces using safe remap
    for (let f = 0; f < 6; f++) {
        remapUVsToRect(geom, f, u0, v0, u1, v1);
    }

    const mat = new THREE.MeshBasicMaterial({ map: atlasTex, transparent: true });
    return new THREE.Mesh(geom, mat);
}


function remapUVsToRect(geom, faceIndex, u0, v0, u1, v1) {
    const uv = geom.attributes.uv;

    if (!geom.userData._baseUV) {
        geom.userData._baseUV = uv.array.slice();
    }
    const base = geom.userData._baseUV;

    const du = u1 - u0;
    const dv = v1 - v0;

    const faceBase = faceIndex * 6;

    for (let i = 0; i < 6; i++) {
        const vert = faceBase + i;
        const u = base[vert * 2 + 0];
        const v = base[vert * 2 + 1];
        uv.setXY(vert, u0 + u * du, v0 + v * dv);
    }

    uv.needsUpdate = true;
}


async function resolveModelIdForBlock(blockId, props = null) {
    const name = stripMcPrefix(blockId);
    const bs = await loadBlockstate(name);
    if (!bs) return null;

    // If the caller didn't pass props, we can still force a sensible default
    // for stems in the editor (full-grown looks best).
    const id = (blockId || "").toLowerCase();
    if (!props && (id.includes("melon_stem") || id.includes("pumpkin_stem"))) {
        props = { age: "0" }; // blockstates usually store as strings in json keys
    }

    if (!props && (id.includes("attached_melon_stem") || id.includes("attached_pumpkin_stem"))) {
        props = { age: "7" }; // blockstates usually store as strings in json keys
    }

    if (bs.variants) return getVariantModelId(bs, props, blockId);

    // multipart minimal: pick first apply (you can improve later)
    if (bs.multipart && bs.multipart.length) {
        const first = bs.multipart[0];
        const apply = first.apply;
        const pick = Array.isArray(apply) ? apply[0] : apply;
        return pick && typeof pick === "object" ? pick : null;
    }

    return null;
}

async function resolveFullModel(variant, maxDepth = 24) {
    const modelIdRaw = typeof variant === "string" ? variant : variant?.model;
    if (!modelIdRaw) return null;

    let cur = modelIdRaw;
    let merged = {
        textures: {},
        elements: null,
        render_type: null,
        parentChain: [],   // <--- add
        variant
    };

    for (let i = 0; i < maxDepth; i++) {
        const m = await loadModel(cur);
        if (!m) return null;

        merged.textures = { ...merged.textures, ...(m.textures || {}) };

        if (!merged.render_type && m.render_type) merged.render_type = m.render_type;

        if (!merged.elements && Array.isArray(m.elements)) merged.elements = m.elements;

        if (m.parent) merged.parentChain.push(m.parent);

        if (!m.parent) break;
        cur = m.parent.startsWith("minecraft:") ? m.parent : `minecraft:${m.parent}`;
    }

    if (!merged.elements) return null;
    return merged;
}

function shouldMirrorPerFaceCubes(model) {
    // detect “individual block face” cubes by: multiple distinct textures across faces
    // (ignore cross models etc — those are not cube faces)
    if (!model || !model.elements || !Array.isArray(model.elements)) return false;

    const chain = (model.parentChain || []).join(" ").toLowerCase();
    if (chain.includes("cross") || chain.includes("tinted_cross")) return false;

    const tex = model.textures || {};
    const faces = model.elements?.[0]?.faces; // usually enough for cube models
    if (!faces) return false;

    const faceNames = ["north","south","east","west","up","down"];

    const ids = new Set();
    for (const fn of faceNames) {
        const f = faces[fn];
        if (!f?.texture) continue;

        // resolveTextureRef handles "#side" indirections etc
        const resolved = resolveTextureRef(tex, f.texture);
        if (resolved) ids.add(resolved);
    }

    // “per-face” block if it uses >= 2 different texture keys across its faces
    return ids.size >= 2;
}


function buildMeshFromModel(atlas, model, blockId, props) {
    const { atlasMeta, atlasTex } = atlas;

    // One geometry for whole model
    const positions = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    let idxBase = 0;
    const mirrorPerFace = shouldMirrorPerFaceCubes(model);

    // Each element is a box from [from] to [to] in 0..16
    for (const el of model.elements) {
        const from = el.from; // [x,y,z]
        const to = el.to;

        // build the 8 corners in 0..16 space
        const X0 = from[0], Y0 = from[1], Z0 = from[2];
        const X1 = to[0],   Y1 = to[1],   Z1 = to[2];

        const rot = el.rotation;

        const V = (x,y,z) => {
            let p = [x,y,z];
            p = applyElementRotation(p, rot);
            return [p[0]/16 - 0.5, p[1]/16 - 0.5, p[2]/16 - 0.5];
        };

        const faces = el.faces || {};

        // north (-Z)
        idxBase = pushFaceIf(faces, "north",
            V(X0,Y0,Z0), V(X1,Y0,Z0), V(X1,Y1,Z0), V(X0,Y1,Z0),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props
        );

        // south (+Z)
        idxBase = pushFaceIf(faces, "south",
            V(X1,Y0,Z1), V(X0,Y0,Z1), V(X0,Y1,Z1), V(X1,Y1,Z1),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props
        );

        // west (-X)
        idxBase = pushFaceIf(faces, "west",
            V(X0,Y0,Z1), V(X0,Y0,Z0), V(X0,Y1,Z0), V(X0,Y1,Z1),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props
        );

        // east (+X)
        idxBase = pushFaceIf(faces, "east",
            V(X1,Y0,Z0), V(X1,Y0,Z1), V(X1,Y1,Z1), V(X1,Y1,Z0),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props
        );

        // up (+Y)
        idxBase = pushFaceIf(faces, "up",
            V(X0,Y1,Z0), V(X1,Y1,Z0), V(X1,Y1,Z1), V(X0,Y1,Z1),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props
        );

        // down (-Y)
        idxBase = pushFaceIf(faces, "down",
            V(X0,Y0,Z1), V(X1,Y0,Z1), V(X1,Y0,Z0), V(X0,Y0,Z0),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props
        );
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();


    const rt = (model.render_type || "").toLowerCase();
    let isCutout = rt.includes("cutout");
    let isTranslucent = rt.includes("translucent");

    if (!isCutout && !isTranslucent) {
        const bid = (blockId || "").toLowerCase();
        if (bid.includes("glass") || bid.includes("ice")) isTranslucent = true;
        if (!isTranslucent) isCutout = inferCutout(model, blockId);
    }

// --- MATERIAL RULES ---
// Cutout: discard pixels (no blending), single-sided, write depth
// Translucent: blend, double-sided, don't write depth
    let mat;
    if (isTranslucent) {
        mat = new THREE.MeshBasicMaterial({
            map: atlasTex,
            transparent: true,
            opacity: 1,
            alphaTest: 0.0,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true,
        });
    } else if (isCutout) {
        mat = new THREE.MeshBasicMaterial({
            map: atlasTex,
            transparent: false,     // <-- IMPORTANT
            alphaTest: 0.5,         // <-- IMPORTANT (try 0.33 if edges look too harsh)
            side: THREE.FrontSide,  // <-- IMPORTANT (kills the “mirrored overlap”)
            depthWrite: true,
            depthTest: true,
        });
    } else {
        mat = new THREE.MeshBasicMaterial({
            map: atlasTex,
            transparent: false,
            alphaTest: 0.0,
            side: THREE.FrontSide,
            depthWrite: true,
            depthTest: true,
        });
    }

    mat.toneMapped = false; // keep textures “minecraft-like”
    mat.vertexColors = true;

    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.blockId = blockId;
    return mesh;
}

function sampleColormap(map, u, v) {
    // u,v in [0..1], Minecraft colormaps are sampled with (x=u*(w-1), y=(1-v)*(h-1))
    if (!map) return { r: 1, g: 1, b: 1 };

    const x = Math.max(0, Math.min(map.w - 1, Math.round(u * (map.w - 1))));
    const y = Math.max(0, Math.min(map.h - 1, Math.round((1 - v) * (map.h - 1))));

    const idx = (y * map.w + x) * 4;
    const d = map.data;

    return { r: d[idx] / 255, g: d[idx + 1] / 255, b: d[idx + 2] / 255 };
}

// "Base biome-ish" sample point.
// Minecraft uses biome temperature/rainfall; for a good default look we pick a middle value.
const DEFAULT_BIOME_U = 0.5;
const DEFAULT_BIOME_V = 0.5;

function srgbToLinear(c) {
    // exact sRGB → linear conversion
    if (c <= 0.04045) return c / 12.92;
    return Math.pow((c + 0.055) / 1.055, 2.4);
}

function toLinearRGB(col) {
    return {
        r: srgbToLinear(col.r),
        g: srgbToLinear(col.g),
        b: srgbToLinear(col.b),
    };
}

function isFoliageTint(blockId) {
    const id = (blockId || "").toLowerCase();
    return (id.includes("leaves") || id.includes("vine") || id.includes("leaf_litter")) && !id.includes("cherry");
}

function isGrassTint(blockId) {
    const id = (blockId || "").toLowerCase();
    return (
        id.includes("grass") ||
        id.includes("fern") ||
        id.includes("tall_grass") ||
        id.includes("large_fern") ||
        id.includes("seagrass") ||
        id.includes("sugar_cane")
    );
}

function stemTintFromAge(age) {
    // Vanilla-like formula: red increases, green decreases, blue slightly increases
    // age: 0..7
    // const a = Math.max(0, Math.min(7, Number(age ?? 0)));
    console.log(age);
    const a = age;
    const r = (a * 32) / 255;          // 0 .. 224
    const g = (255 - a * 8) / 255;     // 255 .. 199
    const b = (a * 4) / 255;           // 0 .. 28
    return { r, g, b };
}


function getTintForBlockFace(blockId, props) {
    const id = (blockId || "").toLowerCase();

    if (id.includes("lily_pad")) {
        return { r: 0x20/255, g: 0x80/255, b: 0x30/255 };
    }

    if (id.includes("melon_stem") || id.includes("pumpkin_stem") ||
        id.includes("attached_melon_stem") || id.includes("attached_pumpkin_stem")) {
            return stemTintFromAge(props?.age);
    }

    if (isFoliageTint(blockId)) {
        return toLinearRGB(sampleColormap(_foliageMap, DEFAULT_BIOME_U, DEFAULT_BIOME_V));
    }

    if (isGrassTint(blockId)) {
        return toLinearRGB(sampleColormap(_grassMap, DEFAULT_BIOME_U, DEFAULT_BIOME_V));
    }

    return { r: 1, g: 1, b: 1 };
}


function pushFaceIf(
    faces, faceName, v0, v1, v2, v3,
    textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props
) {
    const f = faces[faceName];
    if (!f) return idxBase;

    const texId = resolveTextureRef(textures, f.texture);
    const entry = atlasMeta.textures[texId] || atlasMeta.textures["minecraft:block/debug"];

    // atlas rect in TOP-LEFT space (because tex.flipY=false)
    const r = rectToUVs(entry, atlasMeta.atlasW, atlasMeta.atlasH);
    const U0 = r.u0, V0 = r.v0;
    const U1 = r.u1, V1 = r.v1;

    // model UVs in 0..16, TOP-LEFT origin
    const uvRect = f.uv || [0, 0, 16, 16];

    let [U0m, V0m, U1m, V1m] = uvRect;

// detect mirroring
    const flipU = U0m > U1m;
    const flipV = V0m > V1m;

// normalize so U0m<=U1m and V0m<=V1m
    if (flipU) [U0m, U1m] = [U1m, U0m];
    if (flipV) [V0m, V1m] = [V1m, V0m];

    const tu0 = U0m / 16, tv0 = V0m / 16;
    const tu1 = U1m / 16, tv1 = V1m / 16;

    const rot = f.rotation || 0;

    // v0..v3 correspond to: bottom-left, bottom-right, top-right, top-left
    // In TOP-LEFT UV space: "top" is tv0, "bottom" is tv1
    let quad = [
        [tu0, tv1],
        [tu1, tv1],
        [tu1, tv0],
        [tu0, tv0],
    ];

    quad = rotateQuadUV(quad, rot);

    if (flipU) quad = quad.map(([u, v]) => [1 - u, v]);
    if (flipV) quad = quad.map(([u, v]) => [u, 1 - v]);

    if (mirrorPerFace) {
        if (faceName === "up" || faceName === "down") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
        else {
            quad = quad.map(([u, v]) => [1 - u, v]);
        }
    }

    positions.push(...v0, ...v1, ...v2, ...v3);

    const tint = (f.tintindex !== undefined)
        ? getTintForBlockFace(blockId, props)
        : { r: 1, g: 1, b: 1 };


    for (let i = 0; i < 4; i++) {
        colors.push(tint.r, tint.g, tint.b);
    }


    const du = U1 - U0;
    const dv = V1 - V0;

    for (const [uu, vv] of quad) {
        uvs.push(U0 + uu * du, V0 + vv * dv);
    }

    indices.push(
        idxBase + 0, idxBase + 2, idxBase + 1,
        idxBase + 0, idxBase + 3, idxBase + 2
    );

    return idxBase + 4;
}

function rotatePoint(p, origin, axis, angleDeg) {
    const a = (angleDeg * Math.PI) / 180;
    const s = Math.sin(a), c = Math.cos(a);

    // translate to origin
    let x = p[0] - origin[0];
    let y = p[1] - origin[1];
    let z = p[2] - origin[2];

    if (axis === "x") {
        const y2 = y * c - z * s;
        const z2 = y * s + z * c;
        y = y2; z = z2;
    } else if (axis === "y") {
        const x2 = x * c + z * s;
        const z2 = -x * s + z * c;
        x = x2; z = z2;
    } else if (axis === "z") {
        const x2 = x * c - y * s;
        const y2 = x * s + y * c;
        x = x2; y = y2;
    }

    // translate back
    return [x + origin[0], y + origin[1], z + origin[2]];
}

function hexToRgb01(hex) {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return { r: r/255, g: g/255, b: b/255 };
}


function applyElementRotation(v, rot) {
    if (!rot) return v;

    // Minecraft rotation: origin is in 0..16 space
    const origin = rot.origin ?? [8, 8, 8];
    const axis = rot.axis;      // "x"|"y"|"z"
    const angle = rot.angle;    // usually 22.5 / 45 / 90
    const rescale = !!rot.rescale; // ignore for now

    return rotatePoint(v, origin, axis, angle);
}

function inferCutout(model, blockId) {
    const chain = (model.parentChain || []).join(" ").toLowerCase();
    const bid = (blockId || "").toLowerCase();

    // model parents that imply cutout geometry
    if (chain.includes("cross") || chain.includes("tinted_cross")) return true;

    // common block-name heuristics
    if (bid.includes("_stem") || bid.includes("attached_") && bid.includes("_stem")) return true;
    if (bid.includes("leaf_litter") || bid.includes("pink_petals") || bid.includes("dripleaf")) return true;
    if (bid.includes("sapling") || bid.includes("flower") || bid.includes("tall_grass") || bid.includes("fern")) return true;
    if (bid.includes("torch") || bid.includes("fire") || bid.includes("campfire")) return true;
    if (bid.includes("crop") || bid.includes("wheat") || bid.includes("carrots") || bid.includes("potatoes")) return true;
    if (bid.includes("rail")) return true;
    if (bid.includes("pane")) return true;
    if (bid.includes("door") || bid.includes("trapdoor") || bid.includes("leaves")) return true;

    return false;
}


function rotateQuadUV(quad, rot) {
    // quad: 4 corners in order [v0,v1,v2,v3]
    // rotations are clockwise in Minecraft model format.
    const r = ((rot % 360) + 360) % 360;
    if (r === 0) return quad;

    // 90 CW: (u,v) -> (v, 1-u)
    // 180: -> (1-u, 1-v)
    // 270: -> (1-v, u)
    const mapOne = (u, v) => {
        if (r === 90) return [v, 1 - u];
        if (r === 180) return [1 - u, 1 - v];
        if (r === 270) return [1 - v, u];
        return [u, v];
    };

    return quad.map(([u, v]) => mapOne(u, v));
}


export function blockIdToTexId(blockId) {
    // "minecraft:stone" -> "minecraft:block/stone"
    const name = blockId.startsWith("minecraft:") ? blockId.slice("minecraft:".length) : blockId;
    return `minecraft:block/${name}`;
}

export async function makeMeshForBlockId(atlas, blockId, props = null) {
    await loadColormapsOnce();



    const modelIdRaw = await resolveModelIdForBlock(blockId, props);
    if (!modelIdRaw) {
        // fallback
        const texId = blockIdToTexId(blockId);
        const mesh = makeTexturedCube(atlas, atlas.atlasMeta.textures[texId] ? texId : "minecraft:block/debug");
        finalizeMesh(mesh, blockId);
        return mesh;
    }

    const model = await resolveFullModel(modelIdRaw);
    if (!model) {
        const texId = blockIdToTexId(blockId);
        const mesh = makeTexturedCube(atlas, atlas.atlasMeta.textures[texId] ? texId : "minecraft:block/debug");
        finalizeMesh(mesh, blockId);
        return mesh;
    }

    if (blockId.includes("melon_stem") || blockId.includes("pumpkin_stem")) {
        props = {age: "0"}
    }
    if (blockId.includes("attached_melon_stem") || blockId.includes("attached_pumpkin_stem")) {
        props = {age: "7"}
    }

    const mesh = buildMeshFromModel(atlas, model, blockId, props);

    mesh.name = `BLOCKMESH:${blockId}:${crypto.randomUUID().slice(0,8)}`;

    const vx = model.variant?.x ?? 0;
    let vy = model.variant?.y ?? 0;

    if (blockId.includes("melon_stem") || blockId.includes("pumpkin_stem") ||
        blockId.includes("attached_melon_stem") || blockId.includes("attached_pumpkin_stem")) {
        vy = (vy + 180) % 360;
    }

    // finalizeMesh(mesh, blockId);
    const rot = new THREE.Matrix4();
    rot.makeRotationFromEuler(
        new THREE.Euler(
            THREE.MathUtils.degToRad(-vx),
            THREE.MathUtils.degToRad(-vy),
            0,
            "YXZ"
        )
    );

// bake rotation into the geometry-space matrix
    mesh.geometry.applyMatrix4(rot);

    const chain = (model.parentChain || []).join(" ").toLowerCase();
    const isCross = chain.includes("cross") || chain.includes("tinted_cross");
    if (isCross) {
        const s = 1.30; // try 1.05..1.20
        mesh.geometry.applyMatrix4(new THREE.Matrix4().makeScale(s, 1.0, s));
    }

// keep the mesh transform clean (placement/rigging owns this)
    mesh.position.set(0,0,0);
    mesh.quaternion.identity();
    mesh.scale.set(1,1,1);

    finalizeMesh(mesh, blockId);

    return mesh;
}

function finalizeMesh(mesh, blockId) {

    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;

    mesh.userData.isPlaceable = true;
    mesh.userData.kind = "block";
    mesh.userData.blockId = blockId;
}




// ---- minimal asset paths (adjust to your folder layout) ----
const BLOCKSTATES_BASE = "../Resources/blockstates/";
const MODELS_BASE      = "../Resources/models/";

// ---- caches ----
const _blockstateCache = new Map(); // name -> json
const _modelCache      = new Map(); // "minecraft:block/xyz" -> json

async function fetchJsonCached(url, cache) {
    if (cache.has(url)) return cache.get(url);
    const p = fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    cache.set(url, p);
    return p;
}

function stripMcPrefix(id) {
    return id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id;
}

async function loadBlockstate(name) {
    const url = `${BLOCKSTATES_BASE}${name}.json`;
    return await fetchJsonCached(url, _blockstateCache);
}

async function loadModel(modelIdRaw) {
    if (!modelIdRaw) return null;

    // If someone passed the whole variant object, recover
    if (typeof modelIdRaw === "object") modelIdRaw = modelIdRaw.model;

    if (typeof modelIdRaw !== "string") return null;

    // "minecraft:block/acacia_log" -> "block/acacia_log"
    const p = modelIdRaw.startsWith("minecraft:")
        ? modelIdRaw.slice("minecraft:".length)
        : modelIdRaw;

    const url = `${MODELS_BASE}${p}.json`; // MODELS_BASE ends with "/"

    return await fetchJsonCached(url, _modelCache);
}

async function loadModelMerged(modelIdRaw, maxDepth = 12) {
    // Start at the model referenced by blockstate
    let curId = modelIdRaw;

    let mergedTextures = {};
    let templateParent = null;

    for (let i = 0; i < maxDepth; i++) {
        const m = await loadModel(curId);
        if (!m) return null;

        // Merge textures parent -> child (child wins)
        // We’re walking upward, so do: merged = {parentTextures..., merged...}
        // BUT since we encounter child first, we want parent first then child overrides:
        mergedTextures = { ...(m.textures || {}), ...mergedTextures };

        // Detect cube templates anywhere in the chain
        const p = m.parent;
        if (
            p === "minecraft:block/cube_all" ||
            p === "minecraft:block/cube_column" ||
            p === "minecraft:block/cube_bottom_top" ||
            p === "block/cube_all" ||
            p === "block/cube_column" ||
            p === "block/cube_bottom_top"
        ) {
            // normalize to minecraft:* form
            templateParent = p.startsWith("minecraft:") ? p : `minecraft:${p}`;
            // Don’t break; we can still merge textures from higher parents if needed
        }

        if (!m.parent) break;

        // Move upward
        curId = m.parent.startsWith("minecraft:") ? m.parent : `minecraft:${m.parent}`;
    }

    return { parent: templateParent, textures: mergedTextures };
}

function resolveTextureRef(textures, ref) {
    if (!ref) return null;

    // follow indirections like "#side"
    if (ref.startsWith("#")) {
        const key = ref.slice(1);
        return resolveTextureRef(textures, textures?.[key]);
    }

    // normalize to no-namespace path like "block/acacia_log"
    let p = ref.startsWith("minecraft:") ? ref.slice("minecraft:".length) : ref;

    // common forms:
    // "block/acacia_log"  -> ok
    // "acacia_log"        -> assume block/
    if (!p.includes("/")) p = `block/${p}`;

    // final atlas key MUST match atlas JSON
    return `minecraft:${p}`;

}

function normalizeProps(props) {
    if (!props) return null;
    const out = {};
    for (const [k, v] of Object.entries(props)) {
        // normalize everything to string because blockstate keys are strings like "age=7"
        out[k] = String(v);
    }
    return out;
}

function keyMatchesProps(variantKey, props) {
    // variantKey like: "age=7" or "facing=north,lit=false"
    // props is normalized {age:"7", facing:"north"}
    if (variantKey === "") return true;

    const parts = variantKey.split(",");
    for (const part of parts) {
        const [k, v] = part.split("=");
        if (!k) continue;
        if (props[k] === undefined) return false;
        if (props[k] !== v) return false;
    }
    return true;
}

// For cases where you have props subset, prefer the "most specific" key (most conditions)
function pickBestMatchingVariant(vars, props) {
    let bestKey = null;
    let bestScore = -1;

    for (const key of Object.keys(vars)) {
        if (!keyMatchesProps(key, props)) continue;

        const score = key === "" ? 0 : key.split(",").length;
        if (score > bestScore) {
            bestScore = score;
            bestKey = key;
        }
    }

    return bestKey;
}

function getVariantModelId(blockstateJson, props = null, blockId = null) {
    const vars = blockstateJson?.variants;
    if (!vars) return null;

    const nprops = normalizeProps(props);

    // 1) If props were provided, try to match the exact/most-specific variant FIRST.
    if (nprops) {
        const bestKey = pickBestMatchingVariant(vars, nprops);
        if (bestKey != null) {
            const v = vars[bestKey];
            const first = Array.isArray(v) ? v[0] : v;
            return first && typeof first === "object" ? first : null;
        }
    }

    const entries = Object.entries(vars);

    const pickVariant = (v) => {
        const first = Array.isArray(v) ? v[0] : v;
        return first && typeof first === "object" ? first : null; // {model,x,y,uvlock,weight}
    };

    const pickByKey = (key) => (vars[key] ? pickVariant(vars[key]) : null);

    // -----------------------------
    // 0) Exact default variant
    // -----------------------------
    if (vars[""]) return pickVariant(vars[""]);

    // -----------------------------
    // 0.5) Hard defaults for editor placement (beats scoring)
    // -----------------------------
    const hardPick = (key) => (vars[key] ? pickVariant(vars[key]) : null);

    // Buttons: prefer wall + south + unpowered
    {
        const v =
            hardPick("face=wall,facing=north,powered=false") ||
            hardPick("face=wall,facing=north,powered=true");
        if (v) return v;
    }

    // Stairs: prefer south + bottom + straight
    {
        const v =
            hardPick("facing=north,half=bottom,shape=straight") ||
            hardPick("facing=north,half=bottom,shape=straight,waterlogged=false");
        if (v) return v;
    }


    // Utility: scoring for "default-looking" keys
    // Higher score = better default.
    const scoreKey = (k) => {
        let s = 0;

        // Prefer explicit "normal" defaults
        if (k.includes("waterlogged=false")) s += 50;
        if (k.includes("powered=false")) s += 40;
        if (k.includes("open=false")) s += 25;
        if (k.includes("lit=false")) s += 10;
        if (k.includes("enabled=true")) s += 10;
        if (k.includes("persistent=false")) s += 5;

        // Prefer non-special forms
        if (k.includes("snowy=false")) s += 3;

        // Avoid “special” / odd states
        if (k.includes("waterlogged=true")) s -= 100;
        if (k.includes("powered=true")) s -= 50;
        if (k.includes("open=true")) s -= 20;
        if (k.includes("lit=true")) s -= 5;

        // Avoid rail ascents unless explicitly desired
        if (k.includes("ascending")) s -= 40;

        // Avoid weird shapes
        if (k.includes("shape=inner") || k.includes("shape=outer")) s -= 20;
        if (k.includes("shape=left") || k.includes("shape=right")) s -= 20;

        return s;
    };

    const bestMatch = (predicate) => {
        let best = null;
        let bestScore = -Infinity;

        for (const [k, v] of entries) {
            if (!predicate(k)) continue;
            const s = scoreKey(k);
            if (s > bestScore) {
                bestScore = s;
                best = v;
            }
        }
        return best ? pickVariant(best) : null;
    };

    // -----------------------------
    // 1) Logs / columns: axis=y
    // -----------------------------
    {
        const v =
            pickByKey("axis=y") ||
            pickByKey("axis=y,waterlogged=false") ||
            pickByKey("axis=y,waterlogged=true");
        if (v) return v;
    }

    // -----------------------------
    // 2) Stairs: straight + bottom + facing=south preferred
    // -----------------------------
    {
        const v =
            bestMatch(
                (k) =>
                    k.includes("shape=straight") &&
                    k.includes("half=bottom") &&
                    k.includes("facing=north")
            ) ||
            bestMatch(
                (k) =>
                    k.includes("shape=straight") &&
                    k.includes("half=bottom")
            ) ||
            bestMatch((k) => k.includes("shape=straight")); // last resort for stairs-like
        if (v) return v;
    }

    // -----------------------------
    // 3) Slabs: bottom
    // -----------------------------
    {
        const v = bestMatch((k) => k.includes("type=bottom"));
        if (v) return v;
    }

    // -----------------------------
    // 4) Buttons: wall + facing=south preferred
    // -----------------------------
    {
        // 4) Buttons: strongly prefer wall + powered=false + facing=south
        {
            const v =
                bestMatch(k => k.includes("face=wall") && k.includes("powered=false") && k.includes("facing=north")) ||
                bestMatch(k => k.includes("face=wall") && k.includes("powered=false")) ||
                bestMatch(k => k.includes("face=wall")) ||
                bestMatch(k => k.includes("powered=false")); // last resort, but still better than random
            if (v) return v;
        }

    }

    // -----------------------------
    // 5) Rails: flat north_south preferred, non-ascending otherwise
    // -----------------------------
    {
        const v =
            bestMatch((k) => k.includes("shape=north_south")) ||
            bestMatch(
                (k) =>
                    k.includes("shape=") &&
                    !k.includes("ascending")
            );
        if (v) return v;
    }

    // -----------------------------
    // 6) Big dripleaf: tilt=none, facing=south preferred
    // -----------------------------
    {
        const v =
            bestMatch(
                (k) =>
                    k.includes("tilt=none") &&
                    k.includes("facing=north")
            ) ||
            bestMatch((k) => k.includes("tilt=none"));
        if (v) return v;
    }

    // -----------------------------
    // 7) Hopper: facing=down preferred
    // -----------------------------
    {
        const v = bestMatch((k) => k.includes("facing=down"));
        if (v) return v;
    }

    // -----------------------------
    // 8) Generic facing blocks: prefer facing=south (your editor default),
    //    otherwise facing=north, otherwise any facing.
    // -----------------------------
    {
        const v =
            bestMatch((k) => k.includes("facing=north")) ||
            bestMatch((k) => k.includes("facing=south")) ||
            bestMatch((k) => k.includes("facing="));
        if (v) return v;
    }

    // -----------------------------
    // 9) Final fallback: best-scored variant overall
    // -----------------------------
    {
        let bestK = null;
        let bestScore = -Infinity;

        for (const [k] of entries) {
            const s = scoreKey(k);
            if (s > bestScore) {
                bestScore = s;
                bestK = k;
            }
        }

        if (bestK != null) return pickVariant(vars[bestK]);
    }

    // Absolute fallback
    const first = entries[0];
    return first ? pickVariant(first[1]) : null;
}

export async function loadBlockList() {
    const data = await fetch("../Data/json/BlockList.json").then(r => r.json());
    return data.BLOCKS;
}

export async function makeCubeForBlock(state, blockId, props = null) {
    const atlas = state.atlas;
    return await makeMeshForBlockId(atlas, blockId, props);
}

