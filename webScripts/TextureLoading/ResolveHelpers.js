import {getVariantModelId} from "./VariantHelpers.js";
import {stripMcPrefix, loadBlockstate, loadModel} from "./StaticHelpers.js";

//Resolve Functions

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

    // if (!props) {
    //     const id = (blockId || "").toLowerCase();
    //
    //     if (
    //         id.includes("mushroom_stem") ||
    //         id.includes("red_mushroom_block") ||
    //         id.includes("brown_mushroom_block")
    //     ) {
    //         props = {
    //             north: "true",
    //             south: "true",
    //             east: "true",
    //             west: "true",
    //             up: "true",
    //             down: "true"
    //         };
    //     }
    // }

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

        merged.textures = { ...(m.textures || {}), ...merged.textures };

        if (!merged.render_type && m.render_type) merged.render_type = m.render_type;

        if (!merged.elements && Array.isArray(m.elements)) merged.elements = m.elements;

        if (m.parent) merged.parentChain.push(m.parent);

        if (!m.parent) break;
        cur = m.parent.startsWith("minecraft:") ? m.parent : `minecraft:${m.parent}`;
    }

    if (!merged.elements) return null;
    return merged;
}

export {resolveTextureRef, resolveModelIdForBlock, resolveFullModel}