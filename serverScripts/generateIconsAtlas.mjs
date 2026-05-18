import fs from "node:fs/promises";
import path from "node:path";

const CSS_PATH = path.resolve("../Resources/iconGenData/atlas-data.cbt");
const DATA_PATH = path.resolve("../Resources/iconGenData/unformattedicons.json");
const PNG_PATH = path.resolve("../Data/atlas/icons_atlas.png");
const OUT_PATH = path.resolve("../Data/atlas/icons_atlas.json");

const ICON_W = 32;
const ICON_H = 32;

async function getPngSize(filePath) {
    const buf = await fs.readFile(filePath);

    if (
        buf[0] !== 0x89 ||
        buf[1] !== 0x50 ||
        buf[2] !== 0x4e ||
        buf[3] !== 0x47
    ) {
        throw new Error(`${filePath} is not a PNG`);
    }

    return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
    };
}

function parseCssPositions(cssText) {
    const positions = new Map();

    const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
    let rule;

    while ((rule = ruleRe.exec(cssText))) {
        const selector = rule[1].trim();
        const body = rule[2];

        const classMatches = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
        const classes = classMatches.map((m) => m[1]);

        // skip ONLY actual small mode rules like:
        // .icon-minecraft-sm.icon-minecraft-smithing-table
        if (classes.includes("icon-minecraft-sm")) continue;

        const posMatch = body.match(
            /background-position\s*:\s*(-?\d+)(?:px)?\s+(-?\d+)(?:px)?\s*;?/i
        );
        if (!posMatch) continue;

        const x = Math.abs(Number(posMatch[1]));
        const y = Math.abs(Number(posMatch[2]));

        for (const cssClass of classes) {
            if (!cssClass.startsWith("icon-minecraft-")) continue;
            if (cssClass === "icon-minecraft") continue;
            if (cssClass === "icon-minecraft-sm") continue;

            positions.set(cssClass, { x, y });
        }
    }

    return positions;
}

async function main() {
    await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });

    const [cssText, dataText, pngSize] = await Promise.all([
        fs.readFile(CSS_PATH, "utf8"),
        fs.readFile(DATA_PATH, "utf8"),
        getPngSize(PNG_PATH),
    ]);

    const sourceItems = JSON.parse(dataText);
    const cssPositions = parseCssPositions(cssText);

    const out = {
        atlasW: pngSize.width,
        atlasH: pngSize.height,
        iconW: ICON_W,
        iconH: ICON_H,
        textures: {},
        items: [],
    };

    let missing = 0;

    for (const item of sourceItems) {
        const name = String(item.name || "").trim();
        const label = String(item.label || name).trim();
        const css = String(item.css || "").trim();

        if (!name || !css) continue;

        let pos = cssPositions.get(css);

        if (!pos) {
            const alt = css
                .replace(/^icon-minecraft-/, "")
                .replace(/_/g, "-");

            pos = cssPositions.get(`icon-minecraft-${alt}`);
        }

        if (!pos) {
            console.warn(`Missing CSS position: ${name} / ${css}`);
            missing++;
            continue;
        }

        const id = `minecraft:${name}`;

        out.textures[id] = {
            x: pos.x,
            y: pos.y,
            w: ICON_W,
            h: ICON_H,
            label,
            css,
        };

        out.items.push({
            id,
            name,
            label,
            css,
        });
    }

    await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));

    console.log(`Wrote ${OUT_PATH}`);
    console.log(`Atlas size: ${out.atlasW}x${out.atlasH}`);
    console.log(`Textures: ${Object.keys(out.textures).length}`);
    console.log(`Items: ${out.items.length}`);
    console.log(`Missing: ${missing}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});