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

function escapeForMinecartCommand(cmd) {
    return cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildFallingBlockCmd(passengers) {
    return `summon minecraft:falling_block ~ ~1 ~ {BlockState:{Name:"minecraft:activator_rail",Properties:{powered:"true"}},Time:1,Passengers:[${passengers.join(",")}]}`
}

function mcQuoteString(s) {
    return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function propsToMcNbt(props) {
    if (!props || typeof props !== "object" || Array.isArray(props)) return null;

    const entries = Object.entries(props);
    if (!entries.length) return `Properties:{}`;

    const parts = entries.map(([k, v]) => `${k}:${mcQuoteString(v)}`);
    return `Properties:{${parts.join(",")}}`;
}

function brightnessToMcNbt(brightness) {
    if (brightness == null) return null;

    // accept:
    // 1) number -> brightness:1
    // 2) object -> brightness:{block:15,sky:15}
    if (typeof brightness === "number") {
        return `brightness:${fmt(brightness)}f`;
    }

    if (typeof brightness === "object" && !Array.isArray(brightness)) {
        const parts = [];
        if (brightness.block != null) parts.push(`block:${Number(brightness.block)}`);
        if (brightness.sky != null) parts.push(`sky:${Number(brightness.sky)}`);
        if (!parts.length) return null;
        return `brightness:{${parts.join(",")}}`;
    }

    return null;
}

function tagsToMcNbt(tags) {
    if (!Array.isArray(tags)) return null;

    const cleaned = tags
        .map((t) => String(t).trim())
        .filter(Boolean);

    if (!cleaned.length) return null;

    return `Tags:[${cleaned.map(mcQuoteString).join(",")}]`;
}

function numberFieldToMcNbt(key, value) {
    if (value == null || value === "") return null;

    const n = Number(value);
    if (!Number.isFinite(n)) return null;

    return `${key}:${fmt(n)}f`;
}

function buildBlockStateNbt(ent) {
    const propsNbt = propsToMcNbt(ent.properties);
    if (propsNbt) {
        return `{Name:"${ent.blockName}",${propsNbt}}`;
    }
    return `{Name:"${ent.blockName}"}`;
}

export function entityToSummonCmd(ent, origin = "~0.5 ~0.5 ~0.5") {
    const m = ent.mesh;
    m.updateMatrixWorld(true);

    const pivotFix = new THREE.Matrix4().makeTranslation(-0.5, -0.5, -0.5);
    const M = new THREE.Matrix4().multiplyMatrices(m.matrixWorld, pivotFix).transpose();

    const nbtParts = [
        `block_state:${buildBlockStateNbt(ent)}`,
        `transformation:${mat4ToMcArray(M)}`
    ];

    const tagsNbt = tagsToMcNbt(ent.tags);
    if (tagsNbt) nbtParts.push(tagsNbt);

    const brightnessNbt = brightnessToMcNbt(ent.brightness);
    if (brightnessNbt) nbtParts.push(brightnessNbt);

    const viewRangeNbt = numberFieldToMcNbt("view_range", ent.viewRange);
    if (viewRangeNbt) nbtParts.push(viewRangeNbt);

    const shadowRadiusNbt = numberFieldToMcNbt("shadow_radius", ent.shadowRadius);
    if (shadowRadiusNbt) nbtParts.push(shadowRadiusNbt);

    const shadowStrengthNbt = numberFieldToMcNbt("shadow_strength", ent.shadowStrength);
    if (shadowStrengthNbt) nbtParts.push(shadowStrengthNbt);

    const nbt = `{${nbtParts.join(",")}}`;
    return `summon minecraft:block_display ${origin} ${nbt}`;
}

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

    for (const p of perEntityPassengers) {
        if (cur.length === 0) {
            cur.push(p);
            continue;
        }

        const testCmd = buildFallingBlockCmd([...cur, p]);
        if (testCmd.length <= limit) {
            cur.push(p);
        } else {
            waves.push(buildFallingBlockCmd(cur));
            cur = [p];
        }
    }

    if (cur.length === 0) {
        waves.push(buildFallingBlockCmd([killPassenger]));
    } else {
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