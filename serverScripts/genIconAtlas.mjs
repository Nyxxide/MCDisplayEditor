import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "canvas";

// Input directories
const ROOT = path.resolve("../Resources/iconGenData");

const ICONS_DIR = path.join(ROOT, "icons");
const OVERRIDES_DIR = path.join(ROOT, "iconOverrides");

// Output directory
const OUT_DIR = path.resolve("../Data/atlas");

const OUT_ATLAS = path.join(OUT_DIR, "icons_atlas.png");
const OUT_JSON = path.join(OUT_DIR, "icons_atlas.json");

const ICON_SIZE = 32;
const COLUMNS = 32;

async function exists(p) {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function ensureDir(p) {
    await fs.mkdir(p, { recursive: true });
}

async function getPngFiles(dir) {
    if (!(await exists(dir))) return [];

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...await getPngFiles(fullPath));
        } else if (
            entry.isFile() &&
            entry.name.toLowerCase().endsWith(".png")
        ) {
            files.push(fullPath);
        }
    }

    return files;
}

function iconNameFromPath(filePath, baseDir) {
    return path
        .relative(baseDir, filePath)
        .replaceAll("\\", "/")
        .replace(/\.png$/i, "");
}

function normalizeIndexedName(name) {
    const match = name.match(/^(.*)-(\d+)$/);

    // Not a numbered variant
    if (!match) {
        return {
            shouldSkip: false,
            normalized: name
        };
    }

    const baseName = match[1];
    const number = Number(match[2]);

    // Keep only -0 variants
    if (number !== 0) {
        return {
            shouldSkip: true,
            normalized: null
        };
    }

    // Convert "block-0" -> "block"
    return {
        shouldSkip: false,
        normalized: baseName
    };
}

async function main() {
    await ensureDir(ROOT);
    await ensureDir(ICONS_DIR);
    await ensureDir(OVERRIDES_DIR);
    await ensureDir(OUT_DIR);

    const iconFiles = await getPngFiles(ICONS_DIR);
    const overrideFiles = await getPngFiles(OVERRIDES_DIR);

    const iconMap = new Map();

    // Base generated icons
    for (const file of iconFiles) {
        const rawName = iconNameFromPath(file, ICONS_DIR);

        const {
            shouldSkip,
            normalized
        } = normalizeIndexedName(rawName);

        if (shouldSkip) {
            console.log(`[skip-indexed] ${rawName}`);
            continue;
        }

        iconMap.set(normalized, file);
    }

// Manual overrides
    for (const file of overrideFiles) {
        const rawName = iconNameFromPath(file, OVERRIDES_DIR);

        const {
            shouldSkip,
            normalized
        } = normalizeIndexedName(rawName);

        if (shouldSkip) {
            console.log(`[skip-indexed-override] ${rawName}`);
            continue;
        }

        iconMap.set(normalized, file);

        console.log(`[override] ${normalized}`);
    }

    const names = [...iconMap.keys()].sort();

    const rows = Math.ceil(names.length / COLUMNS);

    const atlasWidth = COLUMNS * ICON_SIZE;
    const atlasHeight = rows * ICON_SIZE;

    const canvas = createCanvas(atlasWidth, atlasHeight);
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, atlasWidth, atlasHeight);
    ctx.imageSmoothingEnabled = false;

    const atlas = {
        atlasW: atlasWidth,
        atlasH: atlasHeight,
        iconW: ICON_SIZE,
        iconH: ICON_SIZE,
        textures: {}
    };

    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const file = iconMap.get(name);

        const col = i % COLUMNS;
        const row = Math.floor(i / COLUMNS);

        const x = col * ICON_SIZE;
        const y = row * ICON_SIZE;

        const img = await loadImage(file);

        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(
            img,
            x,
            y,
            ICON_SIZE,
            ICON_SIZE
        );

        atlas.textures[`minecraft:${name}`] = {
            x,
            y,
            w: ICON_SIZE,
            h: ICON_SIZE
        };
    }

    await fs.writeFile(
        OUT_ATLAS,
        canvas.toBuffer("image/png")
    );

    await fs.writeFile(
        OUT_JSON,
        JSON.stringify(atlas, null, 2)
    );

    console.log(`[done] Icons packed: ${names.length}`);
    console.log(`[done] Atlas: ${OUT_ATLAS}`);
    console.log(`[done] JSON: ${OUT_JSON}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});