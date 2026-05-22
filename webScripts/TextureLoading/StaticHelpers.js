import {resolveTextureRef} from "./ResolveHelpers.js";
import {rotateQuadUV} from "./RotationHelpers.js";
import {getTintForBlockFace} from "./ColormapHelper.js";
import {rectToUVs} from "./UVRectHelpers.js";

//Constants

const BLOCKSTATES_BASE = "../Resources/blockstates/";
const MODELS_BASE      = "../Resources/models/";

// ---- caches ----
const _blockstateCache = new Map(); // name -> json
const _modelCache      = new Map(); // "minecraft:block/xyz" -> json


// Helper Functions

function blockIdToTexId(blockId) {
    // "minecraft:stone" -> "minecraft:block/stone"
    const name = blockId.startsWith("minecraft:") ? blockId.slice("minecraft:".length) : blockId;
    return `minecraft:block/${name}`;
}

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
    // if(name==="beacon") name = "bcn";
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


function inferCutout(model, blockId) {
    const chain = (model.parentChain || []).join(" ").toLowerCase();
    const bid = (blockId || "").toLowerCase();

    // model parents that imply cutout geometry
    if (chain.includes("cross") || chain.includes("tinted_cross")) return true;

    // common block-name heuristics
    if (bid.includes("_stem") || bid.includes("attached_") && bid.includes("_stem")) return true;
    if (bid.includes("leaf_litter") || bid.includes("pink_petals") || bid.includes("dripleaf")) return true;
    if (bid.includes("sapling") || bid.includes("flower") || bid.includes("tall_grass") || bid.includes("fern") || bid.includes("frogspawn")) return true;
    if (bid.includes("torch") || bid.includes("fire") || bid.includes("campfire") || bid.includes("bars") || bid.includes("azalea")) return true;
    if (bid.includes("crop") || bid.includes("wheat") || bid.includes("carrots") || bid.includes("potatoes") || bid.includes("beetroot") || bid.includes("wart")) return true;
    if (bid.includes("rail") || bid.includes("redstone_wire") || bid.includes("stonecutter") || bid.includes("pointed_dripstone")) return true;
    if (bid.includes("vine") || bid.includes("cactus") || bid.includes("cocoa") || bid.includes("grass_block") || bid.includes("tripwire")) return true;
    if (bid.includes("door") || bid.includes("trapdoor") || bid.includes("leaves") || bid.includes("grate") || bid.includes("glow_lichen")) return true;
    if (bid.includes("seagrass") || bid.includes("vine") || bid.includes("potted") || bid.includes("coral") || bid.includes("calibrated")) return true;
    if (bid.includes("spore") || bid.includes("pitcher") || bid.includes("chain") || bid.includes("sculk") || bid.includes("ladder")) return true;

    return false;
}



// Texture Builders

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

function defaultFaceUV(faceName, from, to) {
    const [x1, y1, z1] = from;
    const [x2, y2, z2] = to;

    switch (faceName) {
        case "down":  return [x1, 16 - z2, x2, 16 - z1];
        case "up":    return [x1, z1, x2, z2];
        case "north": return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
        case "south": return [x1, 16 - y2, x2, 16 - y1];
        case "west":  return [z1, 16 - y2, z2, 16 - y1];
        case "east":  return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
        default:      return [0, 0, 16, 16];
    }
}

function pushFaceIf(
    faces, faceName, v0, v1, v2, v3,
    from, to,
    textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel,
    sourceModelId = "",
    sourceWhen = {},
    elementRotation = null
) {
    const sourceId = (sourceModelId || "").toLowerCase();
    const when = sourceWhen || {};

    const isChorusCenter = sourceId.endsWith("chorus_plant_noside");
    const isChorusThin   = sourceId.endsWith("chorus_plant_noside1");
    const isChorusBulge  = sourceId.endsWith("chorus_plant_noside2");
    const isChorusThin2  = sourceId.endsWith("chorus_plant_noside3");

    let remappedFaceName = faceName;

    if (isChorusThin && when.south === "false") {
        if (faceName === "up") remappedFaceName = "down";
        else if (faceName === "down") remappedFaceName = "up";
    }

    if (isChorusBulge && when.up === "false"){
        if (faceName !== "up" && faceName !== "north") remappedFaceName = "up";
    }

    if (isChorusBulge && when.west === "false") {
        if (faceName === "up" || faceName === "down") {
            remappedFaceName = "west";
        }
    }


    const f = faces[remappedFaceName];
    if (!f) return idxBase;

    let texRef = f.texture;

    // tolerate bare texture keys like "all"
    if (texRef && !texRef.startsWith("#") && textures[texRef]) {
        texRef = `#${texRef}`;
    }

    const texId = resolveTextureRef(textures, texRef);
    const entry = atlasMeta.textures[texId] || atlasMeta.textures["minecraft:block/debug"];

    // atlas rect in TOP-LEFT space (because tex.flipY=false)
    const r = rectToUVs(entry, atlasMeta.atlasW, atlasMeta.atlasH);
    const U0 = r.u0, V0 = r.v0;
    const U1 = r.u1, V1 = r.v1;

    // model UVs in 0..16, TOP-LEFT origin
    let uvRect = f.uv || defaultFaceUV(remappedFaceName, from, to);

    let [U0m, V0m, U1m, V1m] = uvRect;

    // detect mirroring
    const flipU = U0m > U1m;
    const flipV = V0m > V1m;

    // normalize so U0m<=U1m and V0m<=V1m
    if (flipU) [U0m, U1m] = [U1m, U0m];
    if (flipV) [V0m, V1m] = [V1m, V0m];

    const rot = f.rotation || 0;

    // 1) start with LOCAL quad coords in [0..1]
    let quad = [
        [0, 1], // bottom-left
        [1, 1], // bottom-right
        [1, 0], // top-right
        [0, 0], // top-left
    ];

    // 2) apply model rotation in LOCAL space
    quad = rotateQuadUV(quad, rot);

    // 3) apply flip flags in LOCAL space
    if (flipU) quad = quad.map(([u, v]) => [1 - u, v]);
    if (flipV) quad = quad.map(([u, v]) => [u, 1 - v]);

    const usesAutoUV = !f.uv;
    const applyCubeFaceMirror = mirrorPerFace || (usesAutoUV && !isCrossModel);

    // 4) apply cube-face mirroring in LOCAL space
    if (applyCubeFaceMirror) {
        if (remappedFaceName === "up" || remappedFaceName === "down") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        } else {
            quad = quad.map(([u, v]) => [1 - u, v]);
        }
    }

    if (isCrossModel) {
        if (
            remappedFaceName === "south" ||
            remappedFaceName === "east" ||
            remappedFaceName === "west" ||
            remappedFaceName === "north"
        ) {
            quad = quad.map(([u, v]) => [1 - u, v]);
        }
    }

    const isHeavyCore = (blockId || "").toLowerCase().includes("heavy_core");
    const isPortal = (blockId || "").toLowerCase().includes("portal");
    const isRail = (blockId || "").toLowerCase().includes("rail");
    const isLitter = (blockId || "").toLowerCase().includes("leaf_litter") ||
        (blockId || "").toLowerCase().includes("pink_petals") ||
        (blockId || "").toLowerCase().includes("wildflowers");
    const isGlazedTerracotta = (blockId || "").toLowerCase().includes("glazed_terracotta");
    const isCocoa = (blockId || "").toLowerCase().includes("cocoa");
    const isRedstoneWire = (blockId || "").toLowerCase().includes("redstone_wire");
    const isPiston = (blockId || "").toLowerCase().includes("piston");
    const isCommandBlock = (blockId || "").toLowerCase().includes("command_block");
    const isEndPortalFrame = (blockId || "").toLowerCase().includes("end_portal_frame");
    const isTestBlock = (blockId || "").toLowerCase().includes("test_block") || (blockId || "").toLowerCase().includes("test_instance_block");
    const isBeacon = (blockId || "").toLowerCase().includes("bcn");
    const isGlowLichen = (blockId || "").toLowerCase().includes("glow_lichen");
    const isVine = (blockId || "").toLowerCase().includes("vine");
    const isButton = (blockId || "").toLowerCase().includes("button");
    const isCoralFan = (blockId || "").toLowerCase().includes("coral_fan");
    const isDoor = (blockId || "").toLowerCase().includes("_door");
    const isAnythingElse = !isHeavyCore && !isPortal && !isRail && !isLitter && !isGlazedTerracotta && !isCocoa
    && !isRedstoneWire && !isPiston && !isCommandBlock && !isEndPortalFrame && !isBeacon && !isGlowLichen &&!isVine
    && !isChorusCenter && !isChorusThin && !isChorusThin2 && !isChorusBulge && !isButton && !isCoralFan && !isDoor;

    const canonicalQuad = [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
    ];

    // Existing chorus UV experiment block:
    // Note this is still UV override, not face remap.
    if (isChorusCenter && faceName === "north") {
        if (when.down === "false") {
            quad = canonicalQuad.map(([u, v]) => [u, 1 - v]);
        }
    }

    if (isChorusThin && faceName === "down" || isChorusThin && faceName === "up") {
        if (when.south === "false") {
            quad = canonicalQuad.map(([u, v]) => [1 - u, v]);
        }
    }

    if (isChorusBulge && when.west === "false") {
        if (faceName === "up") {
            quad = rotateQuadUV(canonicalQuad, 90);
            // quad = quad.map(([u, v]) => [u,1 -  v]);
        }
        if (faceName === "down") {
            quad = rotateQuadUV(canonicalQuad, 270);
            // quad = quad.map(([u, v]) => [u,1 -  v]);
        }
    }

    if (isChorusBulge && when.up === "false") {
        if (faceName === "north") {
            quad = canonicalQuad.map(([u, v]) => [u, 1 - v]);
        }
        if (faceName === "down"){
            quad = rotateQuadUV(canonicalQuad, 180);
            quad = quad.map(([u, v]) => [u,1 -  v]);
        }
        if (faceName === "west") {
            quad = rotateQuadUV(canonicalQuad, 270);
            quad = quad.map(([u, v]) => [u,1 -  v]);
        }
        if (faceName === "east") {
            quad = rotateQuadUV(canonicalQuad, 90);
            quad = quad.map(([u, v]) => [u,1 -  v]);
        }
    }

    if (isHeavyCore) {
        if (faceName === "north" || faceName === "south" || faceName === "east" || faceName === "west") {
            quad = quad.map(([u, v]) => [1 - u, v]);
        } else if (faceName === "up" || faceName === "down") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
    }

    if (isPortal) {
        if (faceName === "north" || faceName === "south") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
    }

    if (isRail || isTestBlock) {
        if (faceName === "up" || faceName === "down") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
    }

    if (isLitter || isRedstoneWire) {
        if (faceName === "up" || faceName === "down") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
    }

    if (isGlazedTerracotta) {
        if (faceName === "up" || faceName === "down") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
        if (faceName === "east" || faceName === "west") {
            quad = quad.map(([u, v]) => [1 - u, v]);
        }
        if (faceName === "north" || faceName === "south") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
    }

    if (isCocoa) {
        if (faceName === "up" || faceName === "down") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
        if (faceName === "east" || faceName === "west" || faceName === "north" || faceName === "south") {
            quad = quad.map(([u, v]) => [1 - u, v]);
        }
    }

    if (isPiston || isCommandBlock) {
        if (faceName === "east" || faceName === "west") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
    }

    if (isEndPortalFrame) {
        if (faceName === "north" || faceName === "south") {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
    }

    if (isBeacon) {
        if (faceName !== "up") {
            quad = quad.map(([u, v]) => [1 - u, v]);
        }
        else {
            quad = quad.map(([u, v]) => [u, 1 - v]);
        }
    }

    if (isVine || isGlowLichen) {
        if(faceName !== "up") {
            quad = quad.map(([u, v]) => [1 - u, v]);
        }
        else{
            quad = quad.map(([u, v]) => [1 - u, v]);
        }
    }

    if (isDoor) {
        if(faceName === "east" || faceName === "west") {
            quad = quad.map(([u, v]) => [1 - u, v]);
        }
    }

    if (
        isCoralFan &&
        faceName === "up" &&
        elementRotation
    ) {
        const axis = String(elementRotation.axis || "").toLowerCase();
        const angle = Number(elementRotation.angle || 0);

        if (axis === "z" && angle === 22.5) {
            quad = rotateQuadUV(canonicalQuad, 90);
        }

        else if (axis === "z" && angle === -22.5) {
            quad = rotateQuadUV(canonicalQuad, 270);
        }

        else if (axis === "x" && angle === -22.5) {
            quad = canonicalQuad.map(([u, v]) => [1 - u, v]);
        }

        else if (axis === "x" && angle === 22.5) {
            quad = rotateQuadUV(canonicalQuad, 180);
        }
    }

    if (isAnythingElse) {
        if(faceName === "up") {
            quad = quad.map(([u, v]) => [1 - u, 1 - v]);
        }
    }

    // 5) NOW map LOCAL quad into the model's uvRect
    const tu0 = U0m / 16, tv0 = V0m / 16;
    const tu1 = U1m / 16, tv1 = V1m / 16;

    quad = quad.map(([u, v]) => [
        tu0 + u * (tu1 - tu0),
        tv0 + v * (tv1 - tv0),
    ]);

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

    const tri = {
        north: [0,2,1, 0,3,2],
        south: [0,2,1, 0,3,2],
        west:  [0,2,1, 0,3,2],
        east:  [0,2,1, 0,3,2],
        up:    [0,2,1, 0,3,2],
        down:  [0,2,1, 0,3,2],
    }[faceName] || [0,2,1, 0,3,2];

    indices.push(
        idxBase + tri[0], idxBase + tri[1], idxBase + tri[2],
        idxBase + tri[3], idxBase + tri[4], idxBase + tri[5]
    );

    return idxBase + 4;
}



export { shouldMirrorPerFaceCubes, pushFaceIf ,stripMcPrefix, loadBlockstate, loadModel, inferCutout, blockIdToTexId};