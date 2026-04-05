import * as THREE from "three";

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
        id.includes("sugar_cane") ||
        id.includes("bush")
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

    if (id.includes("redstone_wire")) {
        return { r: 75/255, g: 0/255, b: 0/255 };
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

export {getTintForBlockFace, loadColormapsOnce}