import fs from "node:fs/promises";
import path from "node:path";

const SRC_DIR = path.resolve("../Resources/blockstates");
const OUT_DIR = path.resolve("../Data/json");
const files = (await fs.readdir(SRC_DIR)).sort();

let BLOCKS = [];

for(let i = 0; i < files.length; i++) {
    if(!files[i].includes("waxed") && !files[i].includes("wall_head") && !files[i].includes("wall_skull") && !files[i].includes("hanging_sign") && !files[i].includes("wall_sign") && !files[i].includes("wall_banner") && !files[i].includes("void")
        && files[i] !== "water.json" && files[i] !== "lava.json" && files[i] !== "air.json" && files[i] !== "barrier.json" && files[i] !== "light.json" && files[i] !== "bubble_column.json" && files[i] !== "cave_air.json"
        && files[i] !== "moving_piston.json" && files[i] !== "end_gateway.json" && files[i] !== "end_portal.json")  {
        let block = files[i].replace(".json", "");
        BLOCKS.push(`minecraft:${block}`);
    }
}


await fs.writeFile(path.join(OUT_DIR, "BlockList.json"), JSON.stringify({
    BLOCKS
}, null, 2));