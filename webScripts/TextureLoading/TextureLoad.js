import * as THREE from "three";

import { shouldMirrorPerFaceCubes, pushFaceIf, inferCutout, blockIdToTexId, stripMcPrefix, loadBlockstate } from "./StaticHelpers.js";
import { rectToUVs, remapUVsToRect } from "./UVRectHelpers.js";
import { resolveFullModel, resolveModelIdForBlock } from "./ResolveHelpers.js";
import { applyElementRotation } from "./RotationHelpers.js";
import { loadColormapsOnce } from "./ColormapHelper.js";
import { defaultMultipartPropsForBlock } from "./DefaultPropGen.js";
import {
    loadExternalTexture,
    makeSingleChestMesh,
    makeSignMesh,
    makeBedMesh,
    makeBannerMesh,
    makeSkullMesh,
    makeShulkerMesh,
    makeCopperGolemMesh,
    makeConduitMesh,
    makeDecoratedPotMesh,
    makeShelfMesh,
    makeBellMesh
} from "./EntityBlockHelper.js";

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
    tex.colorSpace = THREE.SRGBColorSpace;
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

    for (let f = 0; f < 6; f++) {
        remapUVsToRect(geom, f, u0, v0, u1, v1);
    }

    const mat = new THREE.MeshBasicMaterial({ map: atlasTex, transparent: true });
    return new THREE.Mesh(geom, mat);
}

function isBeaconGlassElement(el) {
    const faces = el?.faces || {};
    const faceList = Object.values(faces);
    if (!faceList.length) return false;
    return faceList.every(f => f && f.texture === "#glass");
}

function matchesWhenClause(when, props = {}) {
    props = props ?? {};

    if (!when) return true;

    for (const [k, v] of Object.entries(when)) {
        if (String(props[k]) !== String(v)) return false;
    }
    return true;
}

function pickMultipartApply(part, blockId, props = {}) {
    const apply = part?.apply;
    if (!Array.isArray(apply)) {
        return apply && typeof apply === "object" ? apply : null;
    }

    if (!apply.length) return null;

    const bid = (blockId || "").toLowerCase();

    if (bid.includes("chorus_plant")) {
        const when = part?.when || {};

        const pickBySuffix = (suffix) =>
            apply.find(a => (a?.model || "").endsWith(suffix));

        const pickBase = () =>
            pickBySuffix("chorus_plant_noside") || apply[0];

        const pickThin = () =>
            pickBySuffix("chorus_plant_noside1") ||
            pickBySuffix("chorus_plant_noside3") ||
            pickBase();

        const pickBulge = () =>
            pickBySuffix("chorus_plant_noside2") || pickBase();

        if (when.north === "false") return pickThin();
        if (when.south === "false") return pickThin();

        if (when.west === "false") return pickBulge();
        if (when.up === "false")   return pickBulge();

        if (when.east === "false") return pickBase();
        if (when.down === "false") return pickBase();

        return pickBase();
    }

    let best = apply[0];
    let bestWeight = best?.weight ?? 1;

    for (const a of apply) {
        const w = a?.weight ?? 1;
        if (w > bestWeight) {
            best = a;
            bestWeight = w;
        }
    }

    return best && typeof best === "object" ? best : null;
}

function normalizeMultipartApplies(bs, props = {}, blockId = "") {
    props = props ?? {};

    if (!bs?.multipart) return [];

    const out = [];

    for (const part of bs.multipart) {
        if (!matchesWhenClause(part.when, props)) continue;

        const picked = pickMultipartApply(part, blockId, props);
        if (picked) out.push({ apply: picked, when: part.when || {} });
    }

    return out;
}

function buildMeshFromModel(atlas, model, blockId, props, opts = {}) {
    if (!model || !model.elements) return null;

    const { atlasMeta, atlasTex } = atlas;

    const positions = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    let idxBase = 0;

    const mirrorPerFace = shouldMirrorPerFaceCubes(model);
    const chain = (model.parentChain || []).join(" ").toLowerCase();
    const isCrossModel = chain.includes("cross") || chain.includes("tinted_cross");

    for (const el of model.elements) {
        const from = el.from;
        const to = el.to;

        const isUpperStem =
            (blockId || "").toLowerCase().includes("attached_") &&
            (
                el.faces?.north?.texture === "#upperstem" ||
                el.faces?.south?.texture === "#upperstem" ||
                el.faces?.east?.texture  === "#upperstem" ||
                el.faces?.west?.texture  === "#upperstem"
            );

        const X0 = from[0], Y0 = from[1], Z0 = from[2];
        const X1 = to[0],   Y1 = to[1],   Z1 = to[2];

        const rot = el.rotation;

        const V = (x, y, z) => {
            let p = [x, y, z];
            if (isUpperStem) p[0] += 7;
            p = applyElementRotation(p, rot);
            return [p[0] / 16 - 0.5, p[1] / 16 - 0.5, p[2] / 16 - 0.5];
        };

        const faces = el.faces || {};

        idxBase = pushFaceIf(
            faces, "north",
            V(X0, Y0, Z0), V(X1, Y0, Z0), V(X1, Y1, Z0), V(X0, Y1, Z0),
            from, to,
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel,
            opts.sourceModelId, opts.sourceWhen
        );

        idxBase = pushFaceIf(
            faces, "south",
            V(X1, Y0, Z1), V(X0, Y0, Z1), V(X0, Y1, Z1), V(X1, Y1, Z1),
            from, to,
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel,
            opts.sourceModelId, opts.sourceWhen
        );

        idxBase = pushFaceIf(
            faces, "west",
            V(X0, Y0, Z1), V(X0, Y0, Z0), V(X0, Y1, Z0), V(X0, Y1, Z1),
            from, to,
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel,
            opts.sourceModelId, opts.sourceWhen
        );

        idxBase = pushFaceIf(
            faces, "east",
            V(X1, Y0, Z0), V(X1, Y0, Z1), V(X1, Y1, Z1), V(X1, Y1, Z0),
            from, to,
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel,
            opts.sourceModelId, opts.sourceWhen
        );

        idxBase = pushFaceIf(
            faces, "up",
            V(X0, Y1, Z0), V(X1, Y1, Z0), V(X1, Y1, Z1), V(X0, Y1, Z1),
            from, to,
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel,
            opts.sourceModelId, opts.sourceWhen
        );

        idxBase = pushFaceIf(
            faces, "down",
            V(X0, Y0, Z1), V(X1, Y0, Z1), V(X1, Y0, Z0), V(X0, Y0, Z0),
            from, to,
            model.textures, atlasMeta, positions, uvs, colors, indices, idxBase, blockId, mirrorPerFace, props, isCrossModel,
            opts.sourceModelId, opts.sourceWhen
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

    if (opts.forceOpaque) {
        isCutout = false;
        isTranslucent = false;
    } else if (opts.forceTranslucent) {
        isCutout = false;
        isTranslucent = true;
    } else if (opts.forceCutout) {
        isCutout = true;
        isTranslucent = false;
    } else {
        if (!isCutout && !isTranslucent) {
            const bid = (blockId || "").toLowerCase();
            if (bid.includes("glass") || bid.includes("ice")) isTranslucent = true;
            if (!isTranslucent) isCutout = inferCutout(model, blockId);
        }
    }

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
            side: isStemLike ? THREE.DoubleSide : THREE.FrontSide,
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

    mat.toneMapped = false;
    mat.vertexColors = true;

    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.blockId = blockId;
    return mesh;
}

async function makeMeshForBlockId(atlas, blockId, props = null) {
    await loadColormapsOnce();

    const bidLower = (blockId || "").toLowerCase();

    // Load blockstate once up front so multipart blocks can be handled correctly
    const blockName = stripMcPrefix(blockId);
    const bs = await loadBlockstate(blockName);

    let effectiveProps = (() => {
        const defaults = defaultMultipartPropsForBlock(blockId);
        if (!defaults) return props ?? null;
        if (!props) return defaults;

        return {
            ...defaults,
            ...props
        };
    })();

    if (bidLower.includes("_shelf")) {
        let texPath = null;

        if (bidLower.includes("oak_shelf")) texPath = "../Resources/textures/block/oak_shelf.png";
        if (bidLower.includes("birch_shelf")) texPath = "../Resources/textures/block/birch_shelf.png";
        if (bidLower.includes("spruce_shelf")) texPath = "../Resources/textures/block/spruce_shelf.png";
        if (bidLower.includes("jungle_shelf")) texPath = "../Resources/textures/block/jungle_shelf.png";
        if (bidLower.includes("acacia_shelf")) texPath = "../Resources/textures/block/acacia_shelf.png";
        if (bidLower.includes("dark_oak_shelf")) texPath = "../Resources/textures/block/dark_oak_shelf.png";
        if (bidLower.includes("cherry_shelf")) texPath = "../Resources/textures/block/cherry_shelf.png";
        if (bidLower.includes("bamboo_shelf")) texPath = "../Resources/textures/block/bamboo_shelf.png";
        if (bidLower.includes("crimson_shelf")) texPath = "../Resources/textures/block/crimson_shelf.png";
        if (bidLower.includes("warped_shelf")) texPath = "../Resources/textures/block/warped_shelf.png";
        if (bidLower.includes("pale_oak_shelf")) texPath = "../Resources/textures/block/pale_oak_shelf.png";
        if (bidLower.includes("mangrove_shelf")) texPath = "../Resources/textures/block/mangrove_shelf.png";

        const tex = await loadExternalTexture(texPath);

        const mesh = makeShelfMesh(tex, bidLower, {
            facing: "north"
        });

        finalizeMesh(mesh, blockId);
        return mesh;
    }

    // Proper multipart handling (fixes mushroom blocks, etc.)
    if (bs?.multipart?.length) {
        const applies = normalizeMultipartApplies(bs, effectiveProps, blockId);

        if (applies.length) {
            const group = new THREE.Group();

            for (const entry of applies) {
                const apply = entry.apply;
                const when = entry.when;

                const model = await resolveFullModel(apply);
                if (!model || !model.elements) continue;

                const mesh = buildMeshFromModel(atlas, model, blockId, effectiveProps, {sourceModelId: apply.model, sourceWhen: when});
                if (!mesh) continue;

                const vx = apply.x ?? 0;
                let vy = apply.y ?? 0;

                if (blockId.includes("melon_stem") || blockId.includes("pumpkin_stem") ||
                    blockId.includes("attached_melon_stem") || blockId.includes("attached_pumpkin_stem")) {
                    vy = (vy + 180) % 360;
                }

                const rot = new THREE.Matrix4();
                rot.makeRotationFromEuler(
                    new THREE.Euler(
                        THREE.MathUtils.degToRad(-vx),
                        THREE.MathUtils.degToRad(-vy),
                        0,
                        "YXZ"
                    )
                );

                if (bidLower.includes("mushroom_block") || bidLower.includes("mushroom_stem")) {
                    rot.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
                }

                mesh.geometry.applyMatrix4(rot);

                const chain = (model.parentChain || []).join(" ").toLowerCase();
                const isCross = chain.includes("cross") || chain.includes("tinted_cross");
                if (isCross) {
                    const s = 1.30;
                    mesh.geometry.applyMatrix4(new THREE.Matrix4().makeScale(s, 1.0, s));
                }

                mesh.position.set(0, 0, 0);
                mesh.quaternion.identity();
                mesh.scale.set(1, 1, 1);

                group.add(mesh);
            }

            if (group.children.length) {
                group.name = `BLOCKMESH:${blockId}:${crypto.randomUUID().slice(0,8)}`;
                finalizeMesh(group, blockId);
                return group;
            }
        }
    }

    const modelIdRaw = await resolveModelIdForBlock(blockId, effectiveProps);
    const model = await resolveFullModel(modelIdRaw);

    if (bidLower.includes("beacon") && model && model.elements) {
        const glassElements = model.elements.filter(isBeaconGlassElement);
        const solidElements = model.elements.filter(el => !isBeaconGlassElement(el));

        const group = new THREE.Group();

        if (solidElements.length) {
            const solidModel = { ...model, elements: solidElements };
            const solidMesh = buildMeshFromModel(atlas, solidModel, blockId, effectiveProps, {
                forceOpaque: true
            });
            if (solidMesh) group.add(solidMesh);
        }

        if (glassElements.length) {
            const glassModel = { ...model, elements: glassElements };
            const glassMesh = buildMeshFromModel(atlas, glassModel, blockId, effectiveProps, {
                forceTranslucent: true
            });
            if (glassMesh) {
                glassMesh.renderOrder = 1;
                group.add(glassMesh);
            }
        }

        group.name = `BLOCKMESH:${blockId}:${crypto.randomUUID().slice(0, 8)}`;

        const vx = model.variant?.x ?? 0;
        let vy = model.variant?.y ?? 0;

        if (blockId.includes("melon_stem") || blockId.includes("pumpkin_stem") ||
            blockId.includes("attached_melon_stem") || blockId.includes("attached_pumpkin_stem")) {
            vy = (vy + 180) % 360;
        }

        const rot = new THREE.Matrix4();
        rot.makeRotationFromEuler(
            new THREE.Euler(
                THREE.MathUtils.degToRad(-vx),
                THREE.MathUtils.degToRad(-vy),
                0,
                "YXZ"
            )
        );

        group.traverse((o) => {
            if (o.isMesh) {
                o.geometry.applyMatrix4(rot);
                o.position.set(0, 0, 0);
                o.quaternion.identity();
                o.scale.set(1, 1, 1);
            }
        });

        finalizeMesh(group, blockId);
        return group;
    }

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
        const isAnyBanner = bid.includes("_banner");
        const isAnyShulker = bid.includes("shulker");
        const isAnyCopperGolem = bid.includes("copper_golem_statue");
        const isAnyShelf = bid.includes("_shelf");
        const isConduit = bid.includes("conduit");
        const isDecoratedPot = bid.includes("decorated");

        if (isAnyChest) {
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
            const mesh = makeSkullMesh(tex, bid, { mirrorSides: false });
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
            const mesh = makeSignMesh(tex, bid);
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
            const mesh = makeBedMesh(tex, bid);
            finalizeMesh(mesh, blockId);
            return mesh;
        }

        if (isAnyBanner) {
            const texPath = "../Resources/textures/blockentity/banner/banner_base.png";
            const tex = await loadExternalTexture(texPath);

            const colorIndex = bid.indexOf("_banner");
            const color = bid.substring(10, colorIndex);

            const mesh = makeBannerMesh(tex, bid, color);
            finalizeMesh(mesh, blockId);
            return mesh;
        }

        if (isAnyShulker) {
            let texPath = "../Resources/textures/blockentity/shulkerbox/shulker.png";

            if (bid.includes("black_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_black.png";
            if (bid.includes("blue_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_blue.png";
            if (bid.includes("brown_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_brown.png";
            if (bid.includes("cyan_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_cyan.png";
            if (bid.includes("gray_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_gray.png";
            if (bid.includes("green_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_green.png";
            if (bid.includes("light_blue_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_light_blue.png";
            if (bid.includes("light_gray_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_light_gray.png";
            if (bid.includes("lime_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_lime.png";
            if (bid.includes("magenta_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_magenta.png";
            if (bid.includes("orange_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_orange.png";
            if (bid.includes("pink_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_pink.png";
            if (bid.includes("purple_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_purple.png";
            if (bid.includes("red_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_red.png";
            if (bid.includes("white_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_white.png";
            if (bid.includes("yellow_shulker_box")) texPath = "../Resources/textures/blockentity/shulkerbox/shulker_yellow.png";

            const tex = await loadExternalTexture(texPath);
            const mesh = makeShulkerMesh(tex, bid);
            finalizeMesh(mesh, blockId);
            return mesh;
        }

        if (isAnyCopperGolem) {
            let texPath = "../Resources/textures/blockentity/copper_golem/copper_golem.png";

            if (bid.includes("exposed")) texPath = "../Resources/textures/blockentity/copper_golem/exposed_copper_golem.png";
            if (bid.includes("weathered")) texPath = "../Resources/textures/blockentity/copper_golem/weathered_copper_golem.png";
            if (bid.includes("oxidized")) texPath = "../Resources/textures/blockentity/copper_golem/oxidized_copper_golem.png";

            const tex = await loadExternalTexture(texPath);
            const mesh = makeCopperGolemMesh(tex, bid);
            finalizeMesh(mesh, blockId);
            return mesh;
        }

        if (isConduit) {
            const tex = await loadExternalTexture("../Resources/textures/blockentity/conduit/base.png");
            const mesh = makeConduitMesh(tex, bid);
            finalizeMesh(mesh, blockId);
            return mesh;
        }

        if (isDecoratedPot) {
            const tex1 = await loadExternalTexture("../Resources/textures/blockentity/decorated_pot/decorated_pot_side.png");
            const tex2 = await loadExternalTexture("../Resources/textures/blockentity/decorated_pot/decorated_pot_base.png");
            const mesh = makeDecoratedPotMesh(tex1, tex2, bid);
            finalizeMesh(mesh, blockId);
            return mesh;
        }

        // Generic fallback for models with no elements (like conduit)
        let texId = blockIdToTexId(blockId);

        if ((!texId || !atlas.atlasMeta.textures[texId]) && model?.textures?.particle) {
            texId = model.textures.particle.startsWith("minecraft:")
                ? model.textures.particle
                : `minecraft:${model.textures.particle}`;
        }

        const mesh = makeTexturedCube(
            atlas,
            (texId && atlas.atlasMeta.textures[texId]) ? texId : "minecraft:block/debug"
        );

        finalizeMesh(mesh, blockId);
        return mesh;
    }

    if (blockId.includes("melon_stem") || blockId.includes("pumpkin_stem")) {
        effectiveProps = { age: "0" };
    }
    if (blockId.includes("attached_melon_stem") || blockId.includes("attached_pumpkin_stem")) {
        effectiveProps = { age: "7" };
    }

    const mesh = buildMeshFromModel(atlas, model, blockId, effectiveProps);
    mesh.name = `BLOCKMESH:${blockId}:${crypto.randomUUID().slice(0, 8)}`;

    const vx = model.variant?.x ?? 0;
    let vy = model.variant?.y ?? 0;

    if (blockId.includes("melon_stem") || blockId.includes("pumpkin_stem") ||
        blockId.includes("attached_melon_stem") || blockId.includes("attached_pumpkin_stem")) {
        vy = (vy + 180) % 360;
    }

    const rot = new THREE.Matrix4();
    rot.makeRotationFromEuler(
        new THREE.Euler(
            THREE.MathUtils.degToRad(-vx),
            THREE.MathUtils.degToRad(-vy),
            0,
            "YXZ"
        )
    );

    if (bidLower.includes("turtle_egg")) {
        rot.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    }


    mesh.geometry.applyMatrix4(rot);

    const chain = (model.parentChain || []).join(" ").toLowerCase();
    const isCross = chain.includes("cross") || chain.includes("tinted_cross");
    if (isCross) {
        const s = 1.30;
        mesh.geometry.applyMatrix4(new THREE.Matrix4().makeScale(s, 1.0, s));
    }

    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);

    if(blockId.includes("bell")){
        const bellTex = await loadExternalTexture("../Resources/textures/blockentity/bell/bell_body.png");
        const bellMesh = makeBellMesh(bellTex, (blockId || "").toLowerCase());
        let bellGroup = new THREE.Group();
        bellGroup.add(bellMesh,mesh);
        finalizeMesh(bellGroup, blockId);
        return bellGroup;
    }

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