// ImportModelFromCommand.js
// ---------------------
// Paste Minecraft summon commands here and rebuild the block_display model in the editor.
//
// Supported input shapes:
// - single summon minecraft:block_display ...
// - falling_block / minecart passenger chains containing summon commands
// - nested Passengers chains
// - legacy transformation object form:
//     transformation:{translation:[...],left_rotation:[...],scale:[...],right_rotation:[...]}
// - matrix transformation form:
//     transformation:[16f,...]
//
// Notes / assumptions:
// - This importer focuses on block_display entities.
// - Old wrappers like `execute as Nyxxide at @s run` are stripped.
// - Imported entities are placed directly into state.entities and state.scene.
// - The imported matrix is converted into the same world-matrix convention used by your exporter.
// - brightness is preserved on the entity object when present, but is not used by the editor renderer.

import * as THREE from "three";
import { setObjectWorldMatrix } from "../3DEditorSetup/TransformLogic.js";
import { makeCubeForBlock } from "../TextureLoading/TextureLoad.js";
import { defaultMultipartPropsForBlock } from "../TextureLoading/DefaultPropGen.js";

// Optional helper: if you exported your default/fallback props helper, this importer can use it
// when an imported block_display omits explicit Properties.


export function initImportCommandLogic(state) {
    const importBtn = document.getElementById("importCmdBtn");
    const importModal = document.getElementById("importCmdModal");
    const importInput = document.getElementById("importCmdInput");
    const importRun = document.getElementById("importCmdRun");
    const importClose = document.getElementById("importCmdClose");

    function openModal() {
        if (!importModal) return;
        importModal.style.display = "flex";
        if (state.orbit) state.orbit.enabled = false;
        requestAnimationFrame(() => {
            importInput?.focus();
        });
    }

    function closeModal() {
        if (!importModal) return;
        importModal.style.display = "none";
        if (state.orbit) state.orbit.enabled = true;
    }

    if (importBtn) {
        importBtn.addEventListener("click", () => {
            openModal();
        });
    }

    if (importClose) {
        importClose.addEventListener("click", () => {
            closeModal();
        });
    }

    if (importModal) {
        importModal.addEventListener("click", (e) => {
            if (e.target === importModal) {
                closeModal();
            }
        });
    }

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && importModal?.style.display !== "none") {
            closeModal();
        }
    });

    if (importRun && importInput) {
        importRun.addEventListener("click", async () => {
            const text = importInput.value || "";
            if (!text.trim()) return;

            try {
                await importCommandTextMerge(state, text);
                closeModal();
                importInput.value = "";
                alert("Command imported.");
            } catch (err) {
                console.error(err);
                alert(`Import failed: ${err?.message || err}`);
            }
        });
    }

    state.api.importCommandTextMerge = (text) => importCommandTextMerge(state, text);
    state.api.parseCommandTextToSaveObject = (text) => parseCommandTextToSaveObject(text);
}

export async function importCommandTextMerge(state, text) {
    const saveObj = parseCommandTextToSaveObject(text);

    const newIds = [];
    for (const se of saveObj.entities) {
        const mesh = await makeCubeForBlock(state, se.blockName, se.properties ?? null);
        state.scene.add(mesh);

        const wm = new THREE.Matrix4().fromArray(se.mat);
        setObjectWorldMatrix(mesh, wm);

        const id = crypto.randomUUID();
        state.entities.push({
            id,
            blockName: se.blockName,
            properties: se.properties ?? null,
            brightness: se.brightness ?? null,
            mesh,
        });
        newIds.push(id);
    }

    state.selectedRefId = null;
    state.selectedIds.clear();
    for (const id of newIds) state.selectedIds.add(id);

    state.api.rebuildSelectionRig?.();
    state.api.updateXformPanelState?.();
    state.api.pushHistory?.("import-command");

    return saveObj;
}

export function parseCommandTextToSaveObject(text) {
    const summonCommands = extractAllBlockDisplaySummons(text);

    const entities = summonCommands.map((cmd) => {
        const parsed = parseSingleBlockDisplaySummon(cmd);
        return {
            id: crypto.randomUUID(),
            blockName: parsed.blockName,
            properties: parsed.properties,
            brightness: parsed.brightness,
            mat: parsed.mat,
        };
    });

    return {
        version: 1,
        entities,
        groups: [],
        refAssets: [],
        refs: [],
    };
}

export function extractAllBlockDisplaySummons(text) {
    const normalized = stripExecuteWrappers(text);

    // Prefer nested Command fields when they exist.
    const nestedCommands = extractQuotedCommandFields(normalized);
    if (nestedCommands.length) {
        const out = [];

        for (const c of nestedCommands) {
            const inner = stripExecuteWrappers(c);

            // recurse so nested passenger/command chains also work
            const nestedInner = extractAllBlockDisplaySummons(inner);
            if (nestedInner.length) {
                out.push(...nestedInner);
            } else {
                out.push(...findSummonCommandsInText(inner));
            }
        }

        const seen = new Set();
        return out.filter((cmd) => {
            if (seen.has(cmd)) return false;
            seen.add(cmd);
            return true;
        });
    }

    // No nested Command fields -> raw text is probably a direct summon / passenger string
    return findSummonCommandsInText(normalized);
}

function stripExecuteWrappers(text) {
    let s = text;

    // remove common legacy wrapper; repeat a few times in case commands are nested
    for (let i = 0; i < 8; i++) {
        const next = s.replace(/\bexecute\s+as\s+Nyxxide\s+at\s+@s\s+run\s+/gi, "");
        if (next === s) break;
        s = next;
    }

    return s;
}

function extractQuotedCommandFields(text) {
    const out = [];
    let i = 0;

    while (i < text.length) {
        const idx = text.indexOf("Command", i);
        if (idx < 0) break;
        i = idx + 7;

        i = skipWs(text, i);
        if (text[i] !== ':') continue;
        i++;
        i = skipWs(text, i);

        const q = text[i];
        if (q !== '"' && q !== "'") continue;

        const { value, end } = readQuoted(text, i);
        out.push(unescapeMinecraftQuoted(value, q));
        i = end;
    }

    return out;
}

function findSummonCommandsInText(text) {
    const out = [];
    let i = 0;
    const lower = text.toLowerCase();

    while (i < text.length) {
        const idx = lower.indexOf("summon", i);
        if (idx < 0) break;

        if (idx > 0 && /[A-Za-z0-9_]/.test(text[idx - 1])) {
            i = idx + 6;
            continue;
        }

        const parsed = tryReadBlockDisplaySummonOnly(text, idx);
        if (parsed) {
            out.push(parsed.command.trim());
            i = parsed.end;
        } else {
            i = idx + 6;
        }
    }

    return out;
}

function tryReadBlockDisplaySummonOnly(text, start) {
    let i = start;

    if (!/^summon\b/i.test(text.slice(i))) return null;
    i += 6;
    i = skipWs(text, i);

    const entityTok = readToken(text, i);
    if (!entityTok.value) return null;

    const entityId = entityTok.value.toLowerCase();
    if (entityId !== "block_display" && entityId !== "minecraft:block_display") {
        return null;
    }

    i = entityTok.end;

    // read up to 3 coords
    for (let k = 0; k < 3; k++) {
        const j = skipWs(text, i);
        if (j >= text.length) {
            i = j;
            break;
        }

        if (text[j] === "{") {
            i = j;
            break;
        }

        const tok = readToken(text, j);
        if (!tok.value) break;
        i = tok.end;
    }

    i = skipWs(text, i);

    if (text[i] !== "{") {
        const end = readUntilDelimiter(text, i);
        return { command: text.slice(start, end), end };
    }

    const comp = readCompound(text, i);
    return {
        command: text.slice(start, comp.end),
        end: comp.end,
    };
}

function parseSingleBlockDisplaySummon(cmd) {
    const m = cmd.match(/summon\s+(minecraft:)?block_display\s+/i);
    if (!m) throw new Error("Not a block_display summon command.");

    const nbtStart = cmd.indexOf('{', m.index + m[0].length);
    if (nbtStart < 0) throw new Error("Summon command has no NBT compound.");

    const { value: nbtText } = readCompound(cmd, nbtStart);
    const nbt = parseSnbtValue(nbtText);

    const blockState = nbt.block_state || nbt.BlockState;
    if (!blockState || typeof blockState !== 'object') {
        throw new Error("block_display summon is missing block_state/BlockState.");
    }

    const blockName = blockState.Name || blockState.name;
    if (!blockName) throw new Error("block_state is missing Name.");

    const explicitProps = normalizeProps(blockState.Properties || blockState.properties || null);
    const properties = explicitProps ?? defaultMultipartPropsForBlock(blockName) ?? null;

    const mat = normalizeTransformationToSavedWorldMat(nbt.transformation);
    const brightness = normalizeBrightness(nbt.brightness ?? null);

    return { blockName, properties, brightness, mat };
}

function normalizeTransformationToSavedWorldMat(transformation) {
    if (Array.isArray(transformation)) {
        if (transformation.length !== 16) {
            throw new Error(`Matrix transformation must contain 16 values, got ${transformation.length}.`);
        }

        // Minecraft command array -> Matrix4 (already transposed by exporter), then undo pivot fix
        const mcMatrix = new THREE.Matrix4().fromArray(transformation);
        const untransposed = mcMatrix.clone().transpose();
        const undoPivotFix = new THREE.Matrix4().makeTranslation(0.5, 0.5, 0.5);
        return untransposed.multiply(undoPivotFix).elements.slice();
    }

    if (!transformation || typeof transformation !== 'object') {
        // no transform -> identity in saved/world form
        return new THREE.Matrix4().identity().elements.slice();
    }

    const translation = vec3FromList(transformation.translation, [0, 0, 0]);
    const scale = vec3FromList(transformation.scale, [1, 1, 1]);
    const leftQuat = quatFromList(transformation.left_rotation, [0, 0, 0, 1]);
    const rightQuat = quatFromList(transformation.right_rotation, [0, 0, 0, 1]);

    const T = new THREE.Matrix4().makeTranslation(translation.x, translation.y, translation.z);
    const L = new THREE.Matrix4().makeRotationFromQuaternion(leftQuat);
    const S = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
    const R = new THREE.Matrix4().makeRotationFromQuaternion(rightQuat);

    // Minecraft display transformation object semantics: T * L * S * R
    const displayMat = new THREE.Matrix4()
        .multiplyMatrices(T, L)
        .multiply(S)
        .multiply(R);

    // Convert display matrix into the saved/world matrix convention expected by your app.
    const undoPivotFix = new THREE.Matrix4().makeTranslation(0.5, 0.5, 0.5);
    return displayMat.multiply(undoPivotFix).elements.slice();
}

function normalizeProps(props) {
    if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
    const out = {};
    for (const [k, v] of Object.entries(props)) {
        out[k] = String(v);
    }
    return Object.keys(out).length ? out : {};
}

function normalizeBrightness(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && !Array.isArray(v)) {
        const out = {};
        if (v.block != null) out.block = Number(v.block);
        if (v.sky != null) out.sky = Number(v.sky);
        return Object.keys(out).length ? out : null;
    }
    return null;
}

function vec3FromList(list, fallback) {
    const arr = Array.isArray(list) ? list : fallback;
    return new THREE.Vector3(Number(arr[0] ?? fallback[0]), Number(arr[1] ?? fallback[1]), Number(arr[2] ?? fallback[2]));
}

function quatFromList(list, fallback) {
    const arr = Array.isArray(list) ? list : fallback;
    return new THREE.Quaternion(
        Number(arr[0] ?? fallback[0]),
        Number(arr[1] ?? fallback[1]),
        Number(arr[2] ?? fallback[2]),
        Number(arr[3] ?? fallback[3])
    );
}

// ---------------- SNBT-ish parser ----------------

function parseSnbtValue(text) {
    const s = text.trim();
    const { value, end } = readValue(s, 0);
    const tail = s.slice(end).trim();
    if (tail) throw new Error(`Unexpected trailing SNBT text: ${tail.slice(0, 60)}`);
    return value;
}

function readValue(s, i) {
    i = skipWs(s, i);
    const ch = s[i];

    if (ch === '{') return readCompoundValue(s, i);
    if (ch === '[') return readListValue(s, i);
    if (ch === '"' || ch === "'") {
        const q = readQuoted(s, i);
        return { value: unescapeMinecraftQuoted(q.value, ch), end: q.end };
    }

    const tok = readToken(s, i);
    if (!tok.value) throw new Error(`Expected value at position ${i}.`);
    return { value: parseAtom(tok.value), end: tok.end };
}

function readCompoundValue(s, i) {
    const raw = readCompound(s, i);
    const body = raw.value.slice(1, -1);
    const obj = {};

    let p = 0;
    while (p < body.length) {
        p = skipWs(body, p);
        if (p >= body.length) break;

        const keyTok = readKey(body, p);
        if (!keyTok.value) throw new Error(`Expected key in compound at position ${p}.`);
        p = skipWs(body, keyTok.end);
        if (body[p] !== ':') throw new Error(`Expected ':' after key '${keyTok.value}'.`);
        p++;

        const val = readValue(body, p);
        obj[keyTok.value] = val.value;
        p = skipWs(body, val.end);

        if (body[p] === ',') {
            p++;
            continue;
        }
    }

    return { value: obj, end: raw.end };
}

function readListValue(s, i) {
    const raw = readBracketed(s, i, '[', ']');
    const body = raw.value.slice(1, -1).trim();
    if (!body) return { value: [], end: raw.end };

    // typed arrays like [I;1,2,3] or [B;1b,0b]
    if (/^[A-Za-z];/.test(body)) {
        return readTypedArrayValue(raw.value, raw.end);
    }

    const arr = [];
    let p = 0;
    while (p < body.length) {
        const val = readValue(body, p);
        arr.push(val.value);
        p = skipWs(body, val.end);
        if (body[p] === ',') p++;
    }

    return { value: arr, end: raw.end };
}

function readTypedArrayValue(rawListText, end) {
    const body = rawListText.slice(1, -1).trim();
    const semi = body.indexOf(';');
    const payload = body.slice(semi + 1).trim();
    if (!payload) return { value: [], end };

    const parts = splitTopLevel(payload, ',');
    return {
        value: parts.map((x) => parseAtom(x.trim())),
        end,
    };
}

function parseAtom(tok) {
    const lower = tok.toLowerCase();
    if (lower === 'true') return 'true';
    if (lower === 'false') return 'false';

    // numeric suffixes: 1b 2s 3l 4f 5d etc.
    if (/^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?[bslfd]$/i.test(tok)) {
        return Number(tok.slice(0, -1));
    }

    if (/^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/i.test(tok)) {
        return Number(tok);
    }

    return tok;
}

function readKey(s, i) {
    i = skipWs(s, i);
    const ch = s[i];
    if (ch === '"' || ch === "'") {
        const q = readQuoted(s, i);
        return { value: unescapeMinecraftQuoted(q.value, ch), end: q.end };
    }

    let j = i;
    while (j < s.length && /[A-Za-z0-9_+\-.]/.test(s[j])) j++;
    return { value: s.slice(i, j), end: j };
}

function readToken(s, i) {
    i = skipWs(s, i);
    let j = i;
    while (j < s.length && !/[\s,{}\[\]]/.test(s[j])) j++;
    return { value: s.slice(i, j), end: j };
}

function readUntilDelimiter(s, i) {
    let j = i;
    while (j < s.length && s[j] !== ',' && s[j] !== '}' && s[j] !== ']') j++;
    return j;
}

function readCompound(s, i) {
    return readBracketed(s, i, '{', '}');
}

function readBracketed(s, i, open, close) {
    if (s[i] !== open) throw new Error(`Expected '${open}' at position ${i}.`);

    let depth = 0;
    let q = null;
    let esc = false;

    for (let j = i; j < s.length; j++) {
        const ch = s[j];

        if (q) {
            if (esc) {
                esc = false;
                continue;
            }
            if (ch === '\\') {
                esc = true;
                continue;
            }
            if (ch === q) q = null;
            continue;
        }

        if (ch === '"' || ch === "'") {
            q = ch;
            continue;
        }

        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) {
                return { value: s.slice(i, j + 1), end: j + 1 };
            }
        }
    }

    throw new Error(`Unclosed '${open}${close}' structure starting at position ${i}.`);
}

function readQuoted(s, i) {
    const q = s[i];
    let j = i + 1;
    let esc = false;
    let out = '';

    for (; j < s.length; j++) {
        const ch = s[j];
        if (esc) {
            out += ch;
            esc = false;
            continue;
        }
        if (ch === '\\') {
            esc = true;
            continue;
        }
        if (ch === q) {
            return { value: out, end: j + 1 };
        }
        out += ch;
    }

    throw new Error(`Unclosed quoted string at position ${i}.`);
}

function unescapeMinecraftQuoted(s, quoteChar) {
    if (quoteChar === '"') {
        return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function skipWs(s, i) {
    while (i < s.length && /\s/.test(s[i])) i++;
    return i;
}

function splitTopLevel(s, delim) {
    const out = [];
    let start = 0;
    let depthCurly = 0;
    let depthSquare = 0;
    let q = null;
    let esc = false;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];

        if (q) {
            if (esc) {
                esc = false;
                continue;
            }
            if (ch === '\\') {
                esc = true;
                continue;
            }
            if (ch === q) q = null;
            continue;
        }

        if (ch === '"' || ch === "'") {
            q = ch;
            continue;
        }

        if (ch === '{') depthCurly++;
        else if (ch === '}') depthCurly--;
        else if (ch === '[') depthSquare++;
        else if (ch === ']') depthSquare--;
        else if (ch === delim && depthCurly === 0 && depthSquare === 0) {
            out.push(s.slice(start, i));
            start = i + 1;
        }
    }

    out.push(s.slice(start));
    return out;
}
