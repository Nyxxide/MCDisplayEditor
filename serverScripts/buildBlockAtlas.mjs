import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "canvas"; // npm i canvas

const SRC_DIR = path.resolve("../Resources/textures/block");
const OUT_DIR = path.resolve("../Data/atlas");
const TILE = 16;

function isPng(name) { return name.toLowerCase().endsWith(".png"); }

const files = (await fs.readdir(SRC_DIR)).filter(isPng).sort();
if (!files.length) throw new Error("No block textures found");

const count = files.length;
const cols = Math.ceil(Math.sqrt(count));
const rows = Math.ceil(count / cols);

const atlasW = cols * TILE;
const atlasH = rows * TILE;

await fs.mkdir(OUT_DIR, { recursive: true });

const canvas = createCanvas(atlasW, atlasH);
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const map = {};

for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const img = await loadImage(path.join(SRC_DIR, file));

    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * TILE;
    const y = row * TILE;

    const w = img.width;
    const h = img.height;

    if(h === w){
        ctx.drawImage(img, x, y, TILE, TILE);
    } else if(h % w === 0){
        ctx.drawImage(img, 0, 0, w, w, x, y, TILE, TILE);
    }


    // key format matches minecraft texture id style
    const texId = `minecraft:block/${path.basename(file, ".png")}`;
    map[texId] = { x, y, w: TILE, h: TILE };
}

await fs.writeFile(path.join(OUT_DIR, "blocks_atlas.png"), canvas.toBuffer("image/png"));
await fs.writeFile(path.join(OUT_DIR, "blocks_atlas.json"), JSON.stringify({
    tileSize: TILE,
    atlasW,
    atlasH,
    textures: map
}, null, 2));

