import fs from "node:fs/promises";
import path from "node:path";

const SRC_DIR = path.resolve("../Resources/blockstates");
const OUT_DIR = path.resolve("../Data/json");
const files = (await fs.readdir(SRC_DIR)).sort();

let BLOCKS = [];

for(let i = 0; i < files.length; i++) {
    if(!files[i].includes("waxed") && !files[i].includes("wall_head")) {
        let block = files[i].replace(".json", "");
        BLOCKS.push(`minecraft:${block}`);
    }
}


await fs.writeFile(path.join(OUT_DIR, "BlockList.json"), JSON.stringify({
    BLOCKS
}, null, 2));