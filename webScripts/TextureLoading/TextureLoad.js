import * as THREE from "three";

import { shouldMirrorPerFaceCubes, pushFaceIf, inferCutout, blockIdToTexId } from "./StaticHelpers.js"
import { rectToUVs, remapUVsToRect } from "./UVRectHelpers.js"
import { resolveFullModel, resolveModelIdForBlock } from "./ResolveHelpers.js";
import { applyElementRotation } from "./RotationHelpers.js"
import { loadColormapsOnce } from "./ColormapHelper.js";
import { loadExternalTexture, makeSingleChestMesh, makeSignMesh, makeBedMesh, makeSkullMesh } from "./EntityBlockHelper.js";

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


function makeTexturedCube(atlas, texId) {
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


function buildMeshFromModel(atlas, model, blockId, props) {
    const { atlasMeta, atlasTex } = atlas;

    // One geometry for whole model
    const positions = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    let idxBase = 0;
    const mirrorPerFace = shouldMirrorPerFaceCubes(model);
    const chain = (model.parentChain || []).join(" ").toLowerCase();
    const isCrossModel = chain.includes("cross") || chain.includes("tinted_cross");

    // Each element is a box from [from] to [to] in 0..16
    for (const el of model.elements) {
        const from = el.from; // [x,y,z]
        const to = el.to;

        // element center in block-space AFTER rotation (use the un-offset from/to center)
        const isUpperStem =
            (blockId || "").toLowerCase().includes("attached_") &&
            (
                el.faces?.north?.texture === "#upperstem" ||
                el.faces?.south?.texture === "#upperstem" ||
                el.faces?.east?.texture  === "#upperstem" ||
                el.faces?.west?.texture  === "#upperstem"
            );

        // build the 8 corners in 0..16 space
        const X0 = from[0], Y0 = from[1], Z0 = from[2];
        const X1 = to[0],   Y1 = to[1],   Z1 = to[2];

        const rot = el.rotation;

        const V = (x, y, z) => {
            let p = [x, y, z];
            if (isUpperStem) {
                p[0] += 7;
            }

            // keep your element rotation exactly as-is
            p = applyElementRotation(p, rot);

            // convert to block-space (-0.5..+0.5)
            return [p[0] / 16 - 0.5, p[1] / 16 - 0.5, p[2] / 16 - 0.5];
        };

        const faces = el.faces || {};

        const bid = (blockId || "").toLowerCase();
        const isStemLike =
            bid.includes("attached_melon_stem") || bid.includes("attached_pumpkin_stem");

        // north (-Z)
            idxBase = pushFaceIf(faces, "north",
            V(X0,Y0,Z0), V(X1,Y0,Z0), V(X1,Y1,Z0), V(X0,Y1,Z0),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel
        );

        // south (+Z)
        idxBase = pushFaceIf(faces, "south",
            V(X1,Y0,Z1), V(X0,Y0,Z1), V(X0,Y1,Z1), V(X1,Y1,Z1),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel
        );

        // west (-X)
        idxBase = pushFaceIf(faces, "west",
            V(X0,Y0,Z1), V(X0,Y0,Z0), V(X0,Y1,Z0), V(X0,Y1,Z1),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel
        );

        // east (+X)
        idxBase = pushFaceIf(faces, "east",
            V(X1,Y0,Z0), V(X1,Y0,Z1), V(X1,Y1,Z1), V(X1,Y1,Z0),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel
        );

        // up (+Y)
        idxBase = pushFaceIf(faces, "up",
            V(X0,Y1,Z0), V(X1,Y1,Z0), V(X1,Y1,Z1), V(X0,Y1,Z1),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel
        );

        // down (-Y)
        idxBase = pushFaceIf(faces, "down",
            V(X0,Y0,Z1), V(X1,Y0,Z1), V(X1,Y0,Z0), V(X0,Y0,Z0),
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel
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
        const bid = (blockId || "").toLowerCase();
        const isStemLike =
            bid.includes("melon_stem") || bid.includes("pumpkin_stem") ||
            bid.includes("attached_melon_stem") || bid.includes("attached_pumpkin_stem");

        mat = new THREE.MeshBasicMaterial({
            map: atlasTex,
            transparent: false,
            alphaTest: 0.5,
            side: isStemLike ? THREE.DoubleSide : THREE.FrontSide,  // ✅ only stems
            // side: THREE.DoubleSide,
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

async function makeMeshForBlockId(atlas, blockId, props = null) {
    await loadColormapsOnce();

    const modelIdRaw = await resolveModelIdForBlock(blockId, props);
    // if (!modelIdRaw) {
    //     // fallback
    //     const texId = blockIdToTexId(blockId);
    //     const mesh = makeTexturedCube(atlas, atlas.atlasMeta.textures[texId] ? texId : "minecraft:block/debug");
    //     finalizeMesh(mesh, blockId);
    //     return mesh;
    // }

    const model = await resolveFullModel(modelIdRaw);
    // if (!model) {
    //     const texId = blockIdToTexId(blockId);
    //     const mesh = makeTexturedCube(atlas, atlas.atlasMeta.textures[texId] ? texId : "minecraft:block/debug");
    //     finalizeMesh(mesh, blockId);
    //     return mesh;
    // }

    if (!model || !model.elements) {
        const bid = (blockId || "").toLowerCase();
        const isAnyChest =
            bid === "minecraft:chest" ||
            bid.endsWith(":chest") ||
            bid.endsWith("_chest") ||
            bid.includes("ender_chest") ||
            bid.includes("trapped_chest");

        const isAnyHead =
            bid === "minecraft:creeper_head" ||
            bid === "minecraft:skeleton_skull" ||
            bid === "minecraft:wither_skeleton_skull" ||
            bid === "minecraft:zombie_head" ||
            bid === "minecraft:player_head" ||
            bid === "minecraft:piglin_head" ||
            bid === "minecraft:dragon_head";

        const isAnySign = bid.includes("sign");

        const isAnyBed = bid.includes("_bed");

        if (isAnyChest){
            let texPath = "../Resources/textures/blockentity/chest/normal.png";
            if (bid.includes("ender_chest")) texPath = "../Resources/textures/blockentity/chest/ender.png";
            if (bid.includes("trapped_chest")) texPath = "../Resources/textures/blockentity/chest/trapped.png";
            if (bid.includes("copper_chest")) texPath = "../Resources/textures/blockentity/chest/copper.png";
            if (bid.includes("exposed_copper_chest")) texPath = "../Resources/textures/blockentity/chest/copper_exposed.png";
            if (bid.includes("weathered_copper_chest")) texPath = "../Resources/textures/blockentity/chest/copper_weathered.png";
            if (bid.includes("oxidized_copper_chest")) texPath = "../Resources/textures/blockentity/chest/copper_oxidized.png";

            const tex = await loadExternalTexture(texPath);
            const mesh = makeSingleChestMesh(tex);
            finalizeMesh(mesh, blockId);
            return mesh;
        }

        if (isAnyHead) {
            let texPath = null;
            if (bid.includes("creeper_head")) texPath = "../Resources/textures/blockentity/heads/creeper/creeper.png";
            if (bid.includes("skeleton_skull")) texPath = "../Resources/textures/blockentity/heads/skeleton/skeleton.png";
            if (bid.includes("wither_skeleton_skull")) texPath = "../Resources/textures/blockentity/heads/skeleton/wither_skeleton.png";

            if (bid.includes("zombie_head")) texPath = "../Resources/textures/blockentity/heads/zombie/zombie.png";
            if (bid.includes("player_head")) texPath = "../Resources/textures/blockentity/heads/player/steve.png";

            if (bid.includes("piglin_head")) texPath = "../Resources/textures/blockentity/heads/piglin/piglin.png";
            if (bid.includes("dragon_head")) texPath = "../Resources/textures/blockentity/heads/enderdragon/dragon.png";

            const tex = await loadExternalTexture(texPath);
            const mesh = makeSkullMesh(tex, bid,{ mirrorSides: false } ); // set true if you see left/right flipped
            finalizeMesh(mesh, blockId);
            return mesh;
        }

        if (isAnySign) {
            let texPath = null;
            if (bid.includes("oak_sign")) texPath = "../Resources/textures/blockentity/signs/oak.png";
            if (bid.includes("birch_sign")) texPath = "../Resources/textures/blockentity/signs/birch.png";
            if (bid.includes("spruce_sign")) texPath = "../Resources/textures/blockentity/signs/spruce.png";
            if (bid.includes("jungle_sign")) texPath = "../Resources/textures/blockentity/signs/jungle.png";
            if (bid.includes("acacia_sign")) texPath = "../Resources/textures/blockentity/signs/acacia.png";
            if (bid.includes("dark_oak_sign")) texPath = "../Resources/textures/blockentity/signs/dark_oak.png";
            if (bid.includes("cherry_sign")) texPath = "../Resources/textures/blockentity/signs/cherry.png";
            if (bid.includes("bamboo_sign")) texPath = "../Resources/textures/blockentity/signs/bamboo.png";
            if (bid.includes("crimson_sign")) texPath = "../Resources/textures/blockentity/signs/crimson.png";
            if (bid.includes("warped_sign")) texPath = "../Resources/textures/blockentity/signs/warped.png";
            if (bid.includes("pale_oak_sign")) texPath = "../Resources/textures/blockentity/signs/pale_oak.png";
            if (bid.includes("mangrove_sign")) texPath = "../Resources/textures/blockentity/signs/mangrove.png";

            const tex = await loadExternalTexture(texPath);
            const mesh = makeSignMesh(tex, bid ); // set true if you see left/right flipped
            finalizeMesh(mesh, blockId);
            return mesh;
        }

        if (isAnyBed) {
            let texPath = null;
            if (bid.includes("black_bed")) texPath = "../Resources/textures/blockentity/bed/black.png";
            if (bid.includes("blue_bed")) texPath = "../Resources/textures/blockentity/bed/blue.png";
            if (bid.includes("brown_bed")) texPath = "../Resources/textures/blockentity/bed/brown.png";
            if (bid.includes("cyan_bed")) texPath = "../Resources/textures/blockentity/bed/cyan.png";
            if (bid.includes("gray_bed")) texPath = "../Resources/textures/blockentity/bed/gray.png";
            if (bid.includes("green_bed")) texPath = "../Resources/textures/blockentity/bed/green.png";
            if (bid.includes("light_blue_bed")) texPath = "../Resources/textures/blockentity/bed/light_blue.png";
            if (bid.includes("light_gray_bed")) texPath = "../Resources/textures/blockentity/bed/light_gray.png";
            if (bid.includes("lime_bed")) texPath = "../Resources/textures/blockentity/bed/lime.png";
            if (bid.includes("magenta_bed")) texPath = "../Resources/textures/blockentity/bed/magenta.png";
            if (bid.includes("orange_bed")) texPath = "../Resources/textures/blockentity/bed/orange.png";
            if (bid.includes("pink_bed")) texPath = "../Resources/textures/blockentity/bed/pink.png";
            if (bid.includes("purple_bed")) texPath = "../Resources/textures/blockentity/bed/purple.png";
            if (bid.includes("red_bed")) texPath = "../Resources/textures/blockentity/bed/red.png";
            if (bid.includes("white_bed")) texPath = "../Resources/textures/blockentity/bed/white.png";
            if (bid.includes("yellow_bed")) texPath = "../Resources/textures/blockentity/bed/yellow.png";


            const tex = await loadExternalTexture(texPath);
            const mesh = makeBedMesh(tex, bid ); // set true if you see left/right flipped
            finalizeMesh(mesh, blockId);
            return mesh;
        }


        // (Later: skulls, signs, bells, etc)
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



export async function loadBlockList() {
    const data = await fetch("../Data/json/BlockList.json").then(r => r.json());
    return data.BLOCKS;
}

export async function makeCubeForBlock(state, blockId, props = null) {
    const atlas = state.atlas;
    return await makeMeshForBlockId(atlas, blockId, props);
}