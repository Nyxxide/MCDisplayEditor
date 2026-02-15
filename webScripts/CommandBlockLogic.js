// CommandBlockLogic.js
// -------------------
// Generates Minecraft summon commands for the placed block_display entities.

import * as THREE from "three";

function fmt(n) {
    const s = Number(n.toFixed(4));
    return Object.is(s, -0) ? 0 : s;
}

function mat4ToMcArray(m) {
    const e = m.elements;
    return (
        `[${fmt(e[0])}f,${fmt(e[1])}f,${fmt(e[2])}f,${fmt(e[3])}f,` +
        `${fmt(e[4])}f,${fmt(e[5])}f,${fmt(e[6])}f,${fmt(e[7])}f,` +
        `${fmt(e[8])}f,${fmt(e[9])}f,${fmt(e[10])}f,${fmt(e[11])}f,` +
        `${fmt(e[12])}f,${fmt(e[13])}f,${fmt(e[14])}f,${fmt(e[15])}f]`
    );
}

export function entityToSummonCmd(ent, origin = "~0.5 ~0.5 ~0.5") {
    const m = ent.mesh;
    m.updateMatrixWorld(true);

    const pivotFix = new THREE.Matrix4().makeTranslation(-0.5, -0.5, -0.5);
    const M = new THREE.Matrix4().multiplyMatrices(m.matrixWorld, pivotFix).transpose();

    const nbt = `{block_state:{Name:"${ent.blockName}"},transformation:${mat4ToMcArray(M)}}`;
    return `summon minecraft:block_display ${origin} ${nbt}`;
}

function escapeForMinecartCommand(cmd) {
    return cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildFallingBlockCmd(passengers) {
    return `summon minecraft:falling_block ~ ~1 ~ {BlockState:{Name:"minecraft:activator_rail",Properties:{powered:"true"}},Time:1,Passengers:[${passengers.join(",")}]}`
}

// NEW: returns an array of commands (waves)
export function exportOneCommand(entities, { maxLen = 32500, safety = 200 } = {}) {
    const limit = Math.max(1000, maxLen - safety);

    const perEntityPassengers = entities.map((ent) => {
        const c = entityToSummonCmd(ent, "~0.5 ~-0.065 ~0.5");
        return `{id:"minecraft:command_block_minecart",Command:"${escapeForMinecartCommand(c)}"}`;
    });

    const killPassenger =
        `{id:"minecraft:command_block_minecart",Command:"kill @e[type=minecraft:command_block_minecart,distance=..2]"}`;

    const waves = [];
    let cur = [];

    // packs passengers into waves by checking final command length
    for (const p of perEntityPassengers) {
        if (cur.length === 0) {
            cur.push(p);
            continue;
        }

        // test if adding this passenger still fits
        const testCmd = buildFallingBlockCmd([...cur, p]);
        if (testCmd.length <= limit) {
            cur.push(p);
        } else {
            // finalize current wave (no kill yet)
            waves.push(buildFallingBlockCmd(cur));
            cur = [p];
        }
    }

    // finalize last wave (add kill)
    if (cur.length === 0) {
        // no entities -> still return a minimal wave that just kills (optional)
        waves.push(buildFallingBlockCmd([killPassenger]));
    } else {
        // ensure kill fits; if not, make kill its own wave
        const lastWithKill = buildFallingBlockCmd([...cur, killPassenger]);
        if (lastWithKill.length <= limit) {
            waves.push(lastWithKill);
        } else {
            waves.push(buildFallingBlockCmd(cur));
            waves.push(buildFallingBlockCmd([killPassenger]));
        }
    }

    return waves;
}
