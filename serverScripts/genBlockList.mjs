import fs from "node:fs/promises";
import path from "node:path";

const SRC_DIR = path.resolve("../Resources/blockstates");
const OUT_DIR = path.resolve("../Data/json");
const files = (await fs.readdir(SRC_DIR)).sort();

let BLOCKS = [];

for(let i = 0; i < files.length; i++) {
    if(!files[i].includes("waxed") && !files[i].includes("wall_head") && !files[i].includes("wall_skull") && !files[i].includes("void")
        && files[i] !== "water.json" && files[i] !== "lava.json" && files[i] !== "air.json" && files[i] !== "barrier.json" && files[i] !== "light.json" &&
        files[i] !== "bubble_column.json" && files[i] !== "cave_air.json" && files[i] !== "moving_piston.json" && !files[i].includes("item_frame"))  {
        let block;
        if(files[i].includes("bcn")){
            block = files[i].replace("bcn.json", "beacon");
        }
        else{
            block = files[i].replace(".json", "");
        }
        BLOCKS.push(`${block}`);
    }
}


await fs.writeFile(path.join(OUT_DIR, "BlockList.json"), JSON.stringify({
    BLOCKS
}, null, 2));