// TransformLogic.js
// ----------------
// Responsible for:
// - Matrix-safe helpers (world-matrix set + reparent)
// - Block mesh factory (cube)
// - TransformControls wiring + snapping
// - Numeric transform panel sync/apply
// - Copy/Paste hotkeys (Ctrl/Cmd+C/V) + panel buttons

import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {gridFine, gridCoarse} from "./SceneFunctions.js"
import { playUiClick } from "../Misc/AudioControl.js";
import { makeCubeForBlock } from "../TextureLoading/TextureLoad.js";
import { getBlockPropertyConfig, getDefaultPropertiesForBlock } from "../TextureLoading/BlockPropertyOptions.js";

/** -------------------- Matrix helpers -------------------- */

let showCoarseGrid = true;

const _tmpM4a = new THREE.Matrix4();
const _tmpM4b = new THREE.Matrix4();

function ensureMatrixDriven(obj) {
    if (!obj) return;
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
}

export function setObjectWorldMatrix(obj, worldMatrix) {
    if (!obj) return;
    ensureMatrixDriven(obj);

    const parent = obj.parent;
    if (parent) {
        parent.updateMatrixWorld(true);
        _tmpM4a.copy(parent.matrixWorld).invert();
        obj.matrix.copy(_tmpM4a.multiply(worldMatrix));
    } else {
        obj.matrix.copy(worldMatrix);
    }
    obj.matrixWorldNeedsUpdate = true;
    obj.updateMatrixWorld(true);
}

export function setObjectWorldTRS(obj, worldMatrix) {
    if (!obj) return;

    // refs must remain TRS-driven for TransformControls & drags
    obj.matrixAutoUpdate = true;

    const parent = obj.parent;
    const local = new THREE.Matrix4();

    if (parent) {
        parent.updateMatrixWorld(true);
        local.copy(parent.matrixWorld).invert().multiply(worldMatrix);
    } else {
        local.copy(worldMatrix);
    }

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    local.decompose(pos, quat, scale);

    obj.position.copy(pos);
    obj.quaternion.copy(quat);
    obj.scale.copy(scale);

    obj.updateMatrixWorld(true);
}

export function attachKeepWorldMatrix(obj, newParent) {
    if (!obj || !newParent) return;

    obj.updateMatrixWorld(true);
    const world = _tmpM4a.copy(obj.matrixWorld);

    if (obj.parent) obj.parent.remove(obj);
    newParent.add(obj);
    newParent.updateMatrixWorld(true);

    _tmpM4b.copy(newParent.matrixWorld).invert();
    const local = _tmpM4b.multiply(world);

    ensureMatrixDriven(obj);
    obj.matrix.copy(local);
    obj.matrixWorldNeedsUpdate = true;
    obj.updateMatrixWorld(true);
}

function getSelectedEntity(state) {
    if (state.selectedRefId) return null;
    if (state.selectedIds.size !== 1) return null;

    const id = [...state.selectedIds][0];
    return state.entities.find((e) => e.id === id) || null;
}

function getExactSelectedGroupEntities(state) {
    if (state.selectedRefId) return null;

    const g = state.api.exactGroupForSelection?.();
    if (!g) return null;

    const ents = g.members
        .map((id) => state.entities.find((e) => e.id === id))
        .filter(Boolean);

    return ents.length ? ents : null;
}

function normalizeTagsFromInput(value) {
    return String(value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function setMetaInputsDisabled(state, disabled) {
    for (const el of [
        state.ui.tagsInput,
        state.ui.viewRangeInput,
        state.ui.blockLightInput,
        state.ui.skyLightInput,
        state.ui.shadowRadiusInput,
        state.ui.shadowStrengthInput
    ]) {
        if (el) el.disabled = disabled;
    }
}

function clearMetaInputs(state) {
    if (state.ui.tagsInput) state.ui.tagsInput.value = "";
    if (state.ui.viewRangeInput) state.ui.viewRangeInput.value = "";
    if (state.ui.blockLightInput) state.ui.blockLightInput.value = "";
    if (state.ui.skyLightInput) state.ui.skyLightInput.value = "";
    if (state.ui.shadowRadiusInput) state.ui.shadowRadiusInput.value = "";
    if (state.ui.shadowStrengthInput) state.ui.shadowStrengthInput.value = "";
}

function getMetaEditableEntities(state) {
    if (state.selectedRefId) return [];

    return [...state.selectedIds]
        .map((id) => state.entities.find((e) => e.id === id))
        .filter(Boolean);
}

function allSameValue(values) {
    if (!values.length) return "";
    const first = values[0] ?? "";
    return values.every((v) => String(v ?? "") === String(first ?? ""))
        ? first
        : "";
}

function fillMetaUIFromEntities(state, entities) {
    if (!entities?.length) {
        clearMetaInputs(state);
        setMetaInputsDisabled(state, true);
        return;
    }

    if (entities.length === 1) {
        fillMetaUIFromEntity(state, entities[0]);
        return;
    }

    setMetaInputsDisabled(state, false);

    // Multi/group tags append, so leave this blank intentionally.
    if (state.ui.tagsInput) {
        const sharedTags = sharedTagsForEntities(entities);
        state.ui.tagsInput.value = sharedTags.join(", ");
        state.ui.tagsInput.placeholder = "Append comma-separated tags";
    }

    if (state.ui.viewRangeInput) {
        state.ui.viewRangeInput.value = allSameValue(entities.map(e => e.viewRange));
    }

    if (state.ui.blockLightInput) {
        state.ui.blockLightInput.value = allSameValue(
            entities.map(e => e.brightness?.block ?? "")
        );
    }

    if (state.ui.skyLightInput) {
        state.ui.skyLightInput.value = allSameValue(
            entities.map(e => e.brightness?.sky ?? "")
        );
    }

    if (state.ui.shadowRadiusInput) {
        state.ui.shadowRadiusInput.value = allSameValue(entities.map(e => e.shadowRadius));
    }

    if (state.ui.shadowStrengthInput) {
        state.ui.shadowStrengthInput.value = allSameValue(entities.map(e => e.shadowStrength));
    }
}

function fillMetaUIFromEntity(state, ent) {
    if (!ent) {
        clearMetaInputs(state);
        setMetaInputsDisabled(state, true);
        return;
    }

    setMetaInputsDisabled(state, false);

    if (state.ui.tagsInput) {
        state.ui.tagsInput.value = Array.isArray(ent.tags) ? ent.tags.join(", ") : "";
    }

    if (state.ui.viewRangeInput) {
        state.ui.viewRangeInput.value = ent.viewRange ?? "";
    }

    if (state.ui.blockLightInput) {
        state.ui.blockLightInput.value =
            (ent.brightness && typeof ent.brightness === "object" && ent.brightness.block != null)
                ? ent.brightness.block
                : "";
    }

    if (state.ui.skyLightInput) {
        state.ui.skyLightInput.value =
            (ent.brightness && typeof ent.brightness === "object" && ent.brightness.sky != null)
                ? ent.brightness.sky
                : "";
    }

    if (state.ui.shadowRadiusInput) {
        state.ui.shadowRadiusInput.value = ent.shadowRadius ?? "";
    }

    if (state.ui.shadowStrengthInput) {
        state.ui.shadowStrengthInput.value = ent.shadowStrength ?? "";
    }
}

function fillMetaUI(state) {
    if (state.selectedRefId) {
        clearMetaInputs(state);
        setMetaInputsDisabled(state, true);
        clearPropertiesUI(state);
        return;
    }

    const entities = getMetaEditableEntities(state);

    if (entities.length) {
        fillMetaUIFromEntities(state, entities);
        fillPropertiesUI(state);
        return;
    }

    clearMetaInputs(state);
    setMetaInputsDisabled(state, true);
    clearPropertiesUI(state);
}

function getSelectedBlockEntities(state) {
    if (state.selectedRefId) return [];

    return [...state.selectedIds]
        .map((id) => state.entities.find((e) => e.id === id))
        .filter(Boolean);
}

function effectivePropsForEntity(ent) {
    return {
        ...(getDefaultPropertiesForBlock(ent.blockName) || {}),
        ...(ent.properties || {}),
    };
}

function propValuesForEntity(ent, propName, propDef) {
    const props = effectivePropsForEntity(ent);

    const values =
        typeof propDef.valuesWhen === "function"
            ? propDef.valuesWhen(props)
            : propDef.values || [];

    return values.map(String);
}

function intersectStringArrays(arrays) {
    if (!arrays.length) return [];

    let out = new Set(arrays[0].map(String));

    for (const arr of arrays.slice(1)) {
        const s = new Set(arr.map(String));
        out = new Set([...out].filter((v) => s.has(v)));
    }

    return [...out];
}

function getPropertyEditableEntities(state) {
    if (state.selectedRefId) return null;

    const entities = getSelectedBlockEntities(state);
    if (!entities.length) return null;

    // Single block: show all properties normally.
    if (entities.length === 1) {
        const ent = entities[0];
        const cfg = getBlockPropertyConfig(ent.blockName);
        return cfg ? { entities, config: cfg } : null;
    }

    const configs = entities.map((ent) => getBlockPropertyConfig(ent.blockName));

    // If any selected block has no property config, only shared editable props can be none.
    if (configs.some((cfg) => !cfg)) return null;

    const firstCfg = configs[0];
    const sharedProperties = {};

    for (const [propName, firstPropDef] of Object.entries(firstCfg.properties || {})) {
        const allHaveProp = configs.every((cfg) => cfg.properties?.[propName]);
        if (!allHaveProp) continue;

        const currentValues = entities.map((ent) => {
            const props = effectivePropsForEntity(ent);
            const cfg = getBlockPropertyConfig(ent.blockName);
            const def = cfg.properties[propName];

            return String(
                props[propName] ??
                def.default ??
                def.values?.[0] ??
                ""
            );
        });

        // Only expose this property if every selected entity currently matches.
        const sameCurrentValue = currentValues.every((v) => v === currentValues[0]);
        if (!sameCurrentValue) continue;

        const allowedSets = entities.map((ent) => {
            const cfg = getBlockPropertyConfig(ent.blockName);
            const def = cfg.properties[propName];
            return propValuesForEntity(ent, propName, def);
        });

        const sharedValues = intersectStringArrays(allowedSets);

        if (!sharedValues.length) continue;
        if (!sharedValues.includes(currentValues[0])) continue;

        sharedProperties[propName] = {
            label: firstPropDef.label || propName,
            values: sharedValues,
            default: currentValues[0],
        };
    }

    if (!Object.keys(sharedProperties).length) return null;

    return {
        entities,
        config: {
            properties: sharedProperties,
        },
    };
}

function clearPropertiesUI(state) {
    if (state.ui.propsFields) state.ui.propsFields.innerHTML = "";
    if (state.ui.propsSection) state.ui.propsSection.style.display = "none";
}

function fillPropertiesUI(state) {
    const target = getPropertyEditableEntities(state);

    if (!target) {
        clearPropertiesUI(state);
        return;
    }

    const { blockName, entities, config } = target;

    if (!state.ui.propsSection || !state.ui.propsFields) return;

    state.ui.propsSection.style.display = "block";
    state.ui.propsFields.innerHTML = "";

    const baseProps = {
        ...(getDefaultPropertiesForBlock(blockName) || {}),
        ...(entities[0].properties || {}),
    };

    for (const [propName, propDef] of Object.entries(config.properties || {})) {
        const row = document.createElement("div");
        row.className = "metaRow propDropdownRow";

        const label = document.createElement("label");
        label.className = "metaLabel";
        label.textContent = propDef.label || propName;

        const values =
            typeof propDef.valuesWhen === "function"
                ? propDef.valuesWhen(baseProps)
                : propDef.values || [];

        const currentValue = String(
            baseProps[propName] ?? propDef.default ?? values?.[0] ?? ""
        );

        const dropdown = makePropertyDropdown(
            propName,
            currentValue,
            values,
            async () => {
                await applyBlockPropertyFromUI(state);
            }
        );

        row.appendChild(label);
        row.appendChild(dropdown);
        state.ui.propsFields.appendChild(row);
    }
}

function makePropertyDropdown(propName, currentValue, values, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "propDropdown";
    wrap.dataset.propName = propName;
    wrap.dataset.value = String(currentValue);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "propDropdownBtn";
    btn.textContent = String(currentValue);

    const menu = document.createElement("div");
    menu.className = "propDropdownMenu";

    for (const value of values) {
        const v = String(value);

        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "propDropdownOption";
        opt.textContent = v;
        opt.dataset.value = v;

        if (v === String(currentValue)) {
            opt.classList.add("active");
        }

        opt.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();

            wrap.dataset.value = v;
            btn.textContent = v;

            menu.querySelectorAll(".propDropdownOption").forEach((o) => {
                o.classList.toggle("active", o.dataset.value === v);
            });

            wrap.classList.remove("open");

            await onChange?.();
        });

        menu.appendChild(opt);
    }

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        document.querySelectorAll(".propDropdown.open").forEach((d) => {
            if (d !== wrap) d.classList.remove("open");
        });

        wrap.classList.toggle("open");
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);

    return wrap;
}

async function replaceEntityMeshPreserveWorld(state, ent) {
    if (!ent?.mesh) return;

    ent.mesh.updateMatrixWorld(true);
    const world = ent.mesh.matrixWorld.clone();

    const old = ent.mesh;

    if (old.parent) old.parent.remove(old);
    else state.scene.remove(old);

    const newMesh = await makeCubeForBlock(
        state,
        ent.blockName,
        ent.properties ?? null
    );

    state.scene.add(newMesh);
    setObjectWorldMatrix(newMesh, world);

    ent.mesh = newMesh;
}

function blockNonNumericTyping(el, { allowNegative = true, allowDecimal = true } = {}) {
    function isAllowedNextValue(next) {
        if (next === "") return true;

        const pattern = allowNegative
            ? (allowDecimal ? /^-?\d*\.?\d*$/ : /^-?\d*$/)
            : (allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/);

        return pattern.test(next);
    }

    el.addEventListener("beforeinput", (e) => {
        if (e.inputType && !e.inputType.startsWith("insert")) return;
        if (e.data == null) return;

        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;

        const next =
            el.value.slice(0, start) +
            e.data +
            el.value.slice(end);

        if (!isAllowedNextValue(next)) {
            e.preventDefault();
        }
    });

    el.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text") ?? "";

        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;

        const next =
            el.value.slice(0, start) +
            text +
            el.value.slice(end);

        if (!isAllowedNextValue(next)) {
            e.preventDefault();
        }
    });
}

function sanitizeNumberInput(el, { min = null, max = null, final = false } = {}) {
    if (!el) return;

    let raw = String(el.value ?? "");

    if (raw.trim() === "") return;

    raw = raw.replace(/[^\d.-]/g, "");

    raw = raw
        .replace(/(?!^)-/g, "")
        .replace(/(\..*)\./g, "$1");

    // Allow temporary typing states
    if (!final && (raw === "-" || raw === "." || raw === "-." || raw.endsWith("."))) {
        el.value = raw;
        return;
    }

    let n = Number(raw);

    if (!Number.isFinite(n)) {
        el.value = "";
        return;
    }

    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);

    el.value = String(n);
}

async function applyBlockPropertyFromUI(state) {
    const target = getPropertyEditableEntities(state);
    if (!target || !state.ui.propsFields) return false;

    state.api.emptySelectionRig?.();

    const newProps = {};
    const dropdowns = state.ui.propsFields.querySelectorAll(".propDropdown[data-prop-name]");

    for (const dropdown of dropdowns) {
        newProps[dropdown.dataset.propName] = String(dropdown.dataset.value);
    }

    const cfg = target.config;

    for (const [propName, propDef] of Object.entries(cfg.properties || {})) {
        if (typeof propDef.valuesWhen !== "function") continue;

        const allowed = propDef.valuesWhen(newProps).map(String);

        if (!allowed.includes(String(newProps[propName]))) {
            newProps[propName] = allowed[0];
        }
    }

    for (const ent of target.entities) {
        ent.properties = {
            ...(ent.properties || {}),
            ...newProps,
        };

        await replaceEntityMeshPreserveWorld(state, ent);
    }

    state.api.rebuildSelectionRig?.();
    state.api.updateHighlight?.();
    fillPropertiesUI(state);

    state.api.pushHistory?.("property-edit");

    return true;
}

function parseOptionalNumberInput(el) {
    if (!el) return null;
    const raw = String(el.value ?? "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function buildBrightnessFromInputs(state) {
    const block = parseOptionalNumberInput(state.ui.blockLightInput);
    const sky = parseOptionalNumberInput(state.ui.skyLightInput);

    if (block == null && sky == null) return null;

    const out = {};
    if (block != null) out.block = block;
    if (sky != null) out.sky = sky;
    return out;
}

function sharedTagsForEntities(entities) {
    if (!entities?.length) return [];

    const tagSets = entities.map((e) => {
        return new Set(Array.isArray(e.tags) ? e.tags : []);
    });

    const first = tagSets[0];

    return [...first].filter((tag) => {
        return tagSets.every((set) => set.has(tag));
    });
}

function applyMetaToEntities(state, entities) {
    if (!entities?.length) return false;

    const tags = normalizeTagsFromInput(state.ui.tagsInput?.value ?? "");
    const viewRange = parseOptionalNumberInput(state.ui.viewRangeInput);
    const brightness = buildBrightnessFromInputs(state);
    const shadowRadius = parseOptionalNumberInput(state.ui.shadowRadiusInput);
    const shadowStrength = parseOptionalNumberInput(state.ui.shadowStrengthInput);

    for (const ent of entities) {
        ent.tags = [...tags];
        ent.viewRange = viewRange;
        ent.brightness = brightness ? { ...brightness } : null;
        ent.shadowRadius = shadowRadius;
        ent.shadowStrength = shadowStrength;
    }

    return true;
}

function applyMetaPatchToEntities(state, entities) {
    if (!entities?.length) return false;

    const appendTags = normalizeTagsFromInput(state.ui.tagsInput?.value ?? "");

    const viewRangeRaw = String(state.ui.viewRangeInput?.value ?? "").trim();
    const blockRaw = String(state.ui.blockLightInput?.value ?? "").trim();
    const skyRaw = String(state.ui.skyLightInput?.value ?? "").trim();
    const shadowRadiusRaw = String(state.ui.shadowRadiusInput?.value ?? "").trim();
    const shadowStrengthRaw = String(state.ui.shadowStrengthInput?.value ?? "").trim();

    const hasViewRange = viewRangeRaw !== "";
    const hasBlock = blockRaw !== "";
    const hasSky = skyRaw !== "";
    const hasShadowRadius = shadowRadiusRaw !== "";
    const hasShadowStrength = shadowStrengthRaw !== "";

    const viewRange = hasViewRange ? Number(viewRangeRaw) : null;
    const block = hasBlock ? Number(blockRaw) : null;
    const sky = hasSky ? Number(skyRaw) : null;
    const shadowRadius = hasShadowRadius ? Number(shadowRadiusRaw) : null;
    const shadowStrength = hasShadowStrength ? Number(shadowStrengthRaw) : null;

    for (const ent of entities) {
        if (appendTags.length) {
            const existing = Array.isArray(ent.tags) ? ent.tags : [];
            ent.tags = [...new Set([...existing, ...appendTags])];
        }

        if (hasViewRange && Number.isFinite(viewRange)) {
            ent.viewRange = viewRange;
        }

        if (hasBlock || hasSky) {
            const nextBrightness = {
                ...(ent.brightness && typeof ent.brightness === "object" ? ent.brightness : {}),
            };

            if (hasBlock && Number.isFinite(block)) nextBrightness.block = block;
            if (hasSky && Number.isFinite(sky)) nextBrightness.sky = sky;

            ent.brightness = Object.keys(nextBrightness).length ? nextBrightness : null;
        }

        if (hasShadowRadius && Number.isFinite(shadowRadius)) {
            ent.shadowRadius = shadowRadius;
        }

        if (hasShadowStrength && Number.isFinite(shadowStrength)) {
            ent.shadowStrength = shadowStrength;
        }
    }

    return true;
}

function applyMetaFromUI(state) {
    if (state.selectedRefId) return false;

    const entities = getMetaEditableEntities(state);
    if (!entities.length) return false;

    if (entities.length === 1) {
        const changed = applyMetaToEntities(state, entities);
        if (changed) state.api.pushHistory?.("meta-edit");
        return changed;
    }

    const changed = applyMetaPatchToEntities(state, entities);
    if (changed) {
        state.api.pushHistory?.("meta-edit-multi");
        fillMetaUI(state);
    }

    return changed;
}

function hookMetaUI(state) {
    const fields = [
        state.ui.tagsInput,
        state.ui.viewRangeInput,
        state.ui.blockLightInput,
        state.ui.skyLightInput,
        state.ui.shadowRadiusInput,
        state.ui.shadowStrengthInput
    ].filter(Boolean);

    for (const el of fields) {
        if (el !== state.ui.tagsInput) {
            const isBrightness =
                el === state.ui.blockLightInput ||
                el === state.ui.skyLightInput;

            blockNonNumericTyping(el, {
                allowNegative: !isBrightness,
                allowDecimal: !isBrightness,
            });
        }

        el.addEventListener("input", () => {
            if (el === state.ui.blockLightInput || el === state.ui.skyLightInput) {
                sanitizeNumberInput(el, { min: 0, max: 15, final: false });
            } else if (el !== state.ui.tagsInput) {
                sanitizeNumberInput(el);
            }
        });

        el.addEventListener("change", () => {
            if (el === state.ui.blockLightInput || el === state.ui.skyLightInput) {
                sanitizeNumberInput(el, { min: 0, max: 15, final: true });
            }

            applyMetaFromUI(state);
        });

        el.addEventListener("blur", () => {
            if (el === state.ui.blockLightInput || el === state.ui.skyLightInput) {
                sanitizeNumberInput(el, { min: 0, max: 15, final: true });
            }

            applyMetaFromUI(state);
        });

        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();

                if (el === state.ui.blockLightInput || el === state.ui.skyLightInput) {
                    sanitizeNumberInput(el, { min: 0, max: 15, final: true });
                }

                applyMetaFromUI(state);
                el.blur();
            }
        });
    }
}

/** -------------------- TransformControls + UI -------------------- */

export function initTransformLogic(state) {
    const { camera, renderer, gizmoScene } = state;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode("translate");
    transform.setSpace("world"); // important for shear behavior
    gizmoScene.add(transform);

    if (state.ui.modeTranslateBtn) {
        state.ui.modeTranslateBtn.addEventListener("click", () => {
            setTransformMode(state, transform, "translate");
        });
    }

    if (state.ui.modeRotateBtn) {
        state.ui.modeRotateBtn.addEventListener("click", () => {
            setTransformMode(state, transform, "rotate");
        });
    }

    if (state.ui.modeScaleBtn) {
        state.ui.modeScaleBtn.addEventListener("click", () => {
            setTransformMode(state, transform, "scale");
        });
    }

    // hide helper lines/wires
    killGizmoWiresHard(transform);

    // snapping (translation uses built-in snap; rotation uses our absolute snapping)
    updateSnaps(state, transform);
    updateVisibleTransformRows(state, transform);
    updateModeButtons(state, transform);

    // ctrl state
    transform.addEventListener("dragging-changed", (e) => {
        state.isTransforming = e.value;
        updateOrbitEnabled(state, transform);

        if (e.value) {
            state.api.stopMeshDrag?.();
            state.api.stopRefDrag?.();

            if (transform.getMode() === "scale" && transform.object) {
                state.scaleDragStart = transform.object.scale.clone();
            } else {
                state.scaleDragStart = null;
            }

            if (transform.getMode() === "translate" && transform.object) {
                beginTranslateSession(state, transform.object);
            } else {
                state.translateSession = null;
            }
        } else {
            // commit temp-rig transforms
            if (state.selectionIsTempRig && transform.object === state.selectionRig) {
                state.api.bakeRigToMeshes?.();
                state.api.rebuildSelectionRig?.();
            }

            state.scaleDragStart = null;
            state.translateSession = null;
            state.api.pushHistory?.("transform");
        }
    });

    transform.addEventListener("change", () => {
        if (!transform.object) return;

        if (transform.getMode() === "translate") {
            applyTranslateConstraints(state, transform.object);
        }

        if (state.shiftHeld && transform.getMode() === "rotate") {
            snapRotationAbsolute(transform.object, state.const.ROT_SNAP_DEG);
        }

        if (state.shiftHeld && transform.getMode() === "scale" && state.scaleDragStart) {
            const obj = transform.object;
            const rxr = safeRatio(obj.scale.x, state.scaleDragStart.x);
            const ryr = safeRatio(obj.scale.y, state.scaleDragStart.y);
            const rzr = safeRatio(obj.scale.z, state.scaleDragStart.z);

            let r = rxr;
            if (Math.abs(ryr - 1) > Math.abs(r - 1)) r = ryr;
            if (Math.abs(rzr - 1) > Math.abs(r - 1)) r = rzr;

            obj.scale.set(
                state.scaleDragStart.x * r,
                state.scaleDragStart.y * r,
                state.scaleDragStart.z * r
            );
        }

        // numeric UI sync
        if (state.selectedRefId && state.activeRig) {
            fillTransformUI(state, state.activeRig);
        } else if (state.selectedIds.size === 1 && !state.selectedRefId) {
            const m = state.api.getOnlySelectedMesh?.();
            if (m) fillTransformUI(state, m);
        } else if (state.selectionBase && state.activeRig && !state.selectionIsTempRig) {
            fillTransformUIRelative(state, state.activeRig, state.selectionBase);
        }
        if (!isMetaInputFocused(state)) {
            fillMetaUI(state);
        }
        state.api.updateHighlight?.();
    });

    // numeric input listeners
    hookNumericUI(state);
    hookMetaUI(state);

    // copy/paste buttons
    if (state.ui.copyBtn) state.ui.copyBtn.addEventListener("click", () => doCopy(state));
    if (state.ui.pasteBtn) state.ui.pasteBtn.addEventListener("click", () => doPaste(state, true));

    window.addEventListener("pointerdown", (e) => {
        const a = document.activeElement;
        if (!a) return;

        const clickedInsideXform = !!e.target.closest("#xformUI");
        if (clickedInsideXform) return;

        if (e.target.closest(".propDropdown")) return;

        document.querySelectorAll(".propDropdown.open").forEach((d) => {
            d.classList.remove("open");
        });

        commitFocusedTransformInput(state);
        commitFocusedMetaInput(state);
    }, true);

    // hotkeys: Ctrl/Cmd+C/V (ignore when typing in inputs)
    window.addEventListener("keydown", (e) => {
        if (modalOpen()) return;
        const isMac = navigator.platform.toLowerCase().includes("mac");
        const mod = isMac ? e.metaKey : e.ctrlKey;

        if (e.key === "Shift") {
            state.shiftHeld = true;
            updateSnaps(state, transform);
            updateVisibleTransformRows(state, transform);
        }

        if (e.key === "Tab") {
            if (!isTextInputFocused()) {
                e.preventDefault();
            }
            state.tabHeld = true;
            updateTransformSpace(state, transform);
        }

        // --- Arrow key nudge (camera-cardinal) ---
        if (isArrowKey(e.key)) {
            if (isPaletteOpen(state) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                return;
            }

            if (isNumericOrTextareaFocused()) return;

            e.preventDefault();

            let step = 0.005;
            if (state.tabHeld) step = 1.0;
            else if (e.shiftKey) step = 0.25;

            const did = nudgeSelectedByArrow(state, transform, e.key, step);
            if (did) return;
        }

        if (e.key === "`") {
            if (isTextInputFocused()) return;

            e.preventDefault();

            const did = snapSelectedToHalfBlockCenters(state, transform);
            if (did) return;
        }

        if (isTextInputFocused()) return;

        if (mod && e.key.toLowerCase() === "c") {
            e.preventDefault();
            doCopy(state);
            return;
        }

        if (mod && e.key.toLowerCase() === "v") {
            e.preventDefault();
            doPaste(state, true);
            return;
        }

        if (mod && e.key.toLowerCase() === "s") {
            e.preventDefault();
            state.api.saveNow?.();
            return;
        }

        // W/E/R mode switching (lets SelectionLogic not care)
        if (e.key === "t" || e.key === "T") {
            playUiClick();
            setTransformMode(state, transform, "translate");
        }
        if (e.key === "r" || e.key === "R") {
            playUiClick();
            setTransformMode(state, transform, "rotate");
        }
        if (e.key === "s" || e.key === "S") {
            playUiClick();
            setTransformMode(state, transform, "scale");
        }
        if (e.key === "h" || e.key === "H") {
            showCoarseGrid = !showCoarseGrid;
            state.debug.showCoarseGrid = showCoarseGrid;

            if (state.debug.floorHelpersVisible !== false) {
                gridFine.visible = !showCoarseGrid;
                gridCoarse.visible = showCoarseGrid;
            }
        }
    });

    window.addEventListener("keyup", (e) => {
        if (modalOpen()) return;
        if (e.key === "Shift") {
            state.shiftHeld = false;
            updateSnaps(state, transform);
            updateVisibleTransformRows(state, transform);
            if (transform.getMode() === "scale") state.scaleDragStart = null;
        }

        if (e.key === "Tab") {
            state.tabHeld = false;
            updateTransformSpace(state, transform);
        }
    });

    // expose in state
    state.api.transform = transform;
    state.api.attachTransformToActiveRig = () => attachTransformToActiveRig(state, transform);
    state.api.fillMetaUI = () => fillMetaUI(state);

    return transform;
}

export function attachTransformToActiveRig(state, transform) {
    transform.detach();
    if (!state.activeRig) return;

    const scaleNode = state.activeRig.userData?.scaleNode;
    if (scaleNode && transform.getMode() === "scale") transform.attach(scaleNode);
    else transform.attach(state.activeRig);

    killGizmoWiresHard(transform);
}

function modalOpen() {
    const modals = document.querySelectorAll(".modalOverlay");
    for (const m of modals) {
        if (window.getComputedStyle(m).display !== "none") return true;
    }
    return false;
}

function setTransformMode(state, transform, mode) {
    transform.setMode(mode);
    updateTransformSpace(state, transform);
    updateVisibleTransformRows(state, transform);
    attachTransformToActiveRig(state, transform);
    updateModeButtons(state, transform);
}

function updateModeButtons(state, transform) {
    const mode = transform?.getMode?.() || "translate";

    const t = state.ui.modeTranslateBtn;
    const r = state.ui.modeRotateBtn;
    const s = state.ui.modeScaleBtn;

    if (t) {
        const active = mode === "translate";
        t.classList.toggle("active", active);
        t.disabled = active;
    }

    if (r) {
        const active = mode === "rotate";
        r.classList.toggle("active", active);
        r.disabled = active;
    }

    if (s) {
        const active = mode === "scale";
        s.classList.toggle("active", active);
        s.disabled = active;
    }
}

function isPaletteOpen(state) {
    const root = state.ui.paletteRoot;
    if (!root) return false;
    return root.dataset.open === "true";
}

function isArrowKey(k) {
    return k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight";
}

function isNumericOrTextareaFocused() {
    const a = document.activeElement;
    if (!a) return false;

    const tag = (a.tagName || "").toLowerCase();
    if (tag === "textarea") return true;

    if (tag === "input") {
        const t = (a.getAttribute("type") || "").toLowerCase();
        // don’t steal arrows from numeric transform fields
        if (t === "number") return true;
    }

    if (a.isContentEditable) return true;
    return false;
}

// returns one of: "N" "E" "S" "W"
function cameraSnappedCardinalVectors(state) {
    const dir = new THREE.Vector3();
    state.camera.getWorldDirection(dir);

    // flatten to XZ plane
    dir.y = 0;

    // if somehow degenerate, default to +Z
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    else dir.normalize();

    // Snap forward to dominant axis (nearest cardinal)
    const ax = Math.abs(dir.x);
    const az = Math.abs(dir.z);

    const fwd = new THREE.Vector3();
    if (ax > az) {
        fwd.set(Math.sign(dir.x) || 1, 0, 0);   // ±X
    } else {
        fwd.set(0, 0, Math.sign(dir.z) || 1);   // ±Z
    }

    // Right vector for that snapped forward (90° clockwise in XZ)
    // If fwd = (0,0,1) => right = (1,0,0)
    // If fwd = (1,0,0) => right = (0,0,-1)
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);

    return { fwd, right };
}

function updateTransformSpace(state, transform) {
    // Tab is now reserved for arrow-key stepping only.
    // Gizmo translate should always stay in world space.
    transform.setSpace("world");
}

function getWorldPositionOf(obj) {
    const v = new THREE.Vector3();
    obj.updateMatrixWorld(true);
    obj.getWorldPosition(v);
    return v;
}

function setWorldPositionOf(obj, worldPos) {
    if (!obj) return;

    if (obj.parent) {
        obj.parent.updateMatrixWorld(true);
        const local = worldPos.clone();
        obj.parent.worldToLocal(local);
        obj.position.copy(local);
    } else {
        obj.position.copy(worldPos);
    }

    obj.updateMatrixWorld(true);
}

function beginTranslateSession(state, obj) {
    const startWorld = getWorldPositionOf(obj);
    const startQuat = new THREE.Quaternion();
    obj.getWorldQuaternion(startQuat);

    const basisX = new THREE.Vector3(1, 0, 0).applyQuaternion(startQuat).normalize();
    const basisY = new THREE.Vector3(0, 1, 0).applyQuaternion(startQuat).normalize();
    const basisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(startQuat).normalize();

    state.translateSession = {
        startWorld,
        basisX,
        basisY,
        basisZ,
        prevRawDeltaLocal: { x: 0, y: 0, z: 0 },
    };
}

function applyTranslateConstraints(state, obj) {
    if (!state.translateSession) return;

    // SHIFT: 0.25 incremental motion from drag start, not absolute grid lock.
    if (state.shiftHeld) {
        applyIncrementalTranslateSnap(state, obj, 0.25);
    }
}

function applyIncrementalTranslateSnap(state, obj, step) {
    const session = state.translateSession;
    if (!session) return;

    const curWorld = getWorldPositionOf(obj);
    const delta = curWorld.clone().sub(session.startWorld);

    delta.x = Math.round(delta.x / step) * step;
    delta.y = Math.round(delta.y / step) * step;
    delta.z = Math.round(delta.z / step) * step;

    const snappedWorld = session.startWorld.clone().add(delta);
    setWorldPositionOf(obj, snappedWorld);
}


function nudgeSelectedByArrow(state, transform, key, step) {
    if (!state.activeRig) return false;

    // don’t fight with gizmo dragging / plane drags
    if (state.isTransforming || transform?.dragging || state.isDraggingMesh || state.isDraggingRef) return false;

    const { fwd, right } = cameraSnappedCardinalVectors(state);

    const delta = new THREE.Vector3();
    if (key === "ArrowUp") delta.copy(fwd);
    if (key === "ArrowDown") delta.copy(fwd).multiplyScalar(-1);
    if (key === "ArrowRight") delta.copy(right).multiplyScalar(-1);
    if (key === "ArrowLeft") delta.copy(right);

    delta.multiplyScalar(step);

    // Refs are TRS driven; blocks/groups are matrix driven but you move the rig
    const rig = state.activeRig;

    rig.position.add(delta);
    rig.updateMatrixWorld(true);

    // If we’re using the temp selectionRig, we must bake so meshes actually move in world
    if (state.selectionIsTempRig && rig === state.selectionRig) {
        state.api.bakeRigToMeshes?.();
        state.api.rebuildSelectionRig?.();
    }

    // Update UI + outline
    if (state.selectedRefId && state.activeRig) {
        fillTransformUI(state, state.activeRig);
    } else if (state.selectedIds.size === 1 && !state.selectedRefId) {
        const m = state.api.getOnlySelectedMesh?.();
        if (m) fillTransformUI(state, m);
    } else if (state.selectionBase && state.activeRig && !state.selectionIsTempRig) {
        fillTransformUIRelative(state, state.activeRig, state.selectionBase);
    }

    state.api.updateHighlight?.();
    state.api.pushHistory?.("nudge");
    return true;
}

function snapHalfCentered(v) {
    // Allowed lattice: ..., -1.5, -0.5, 0.5, 1.5, 2.5, ...
    // Ties like 1.0 / 2.0 / 0.0 fall to the lower .5 value.
    return Math.floor(v) + 0.5;
}

function snapSelectedToHalfBlockCenters(state, transform) {
    if (!state.activeRig) return false;

    // don’t fight with gizmo dragging / plane drags
    if (state.isTransforming || transform?.dragging || state.isDraggingMesh || state.isDraggingRef) {
        return false;
    }

    // --- Single selected block: snap the actual mesh world origin,
    // not the temp selection rig center / bbox center. ---
    if (state.selectedIds.size === 1 && !state.selectedRefId) {
        const mesh = state.api.getOnlySelectedMesh?.();
        if (!mesh) return false;

        const wpos = new THREE.Vector3();
        const wquat = new THREE.Quaternion();
        const wscale = new THREE.Vector3();

        mesh.updateMatrixWorld(true);
        mesh.matrixWorld.decompose(wpos, wquat, wscale);

        wpos.set(
            snapHalfCentered(wpos.x),
            snapHalfCentered(wpos.y),
            snapHalfCentered(wpos.z)
        );

        const world = new THREE.Matrix4().compose(wpos, wquat, wscale);
        setObjectWorldMatrix(mesh, world);

        state.api.rebuildSelectionRig?.();
        fillTransformUI(state, mesh);
        state.api.updateHighlight?.();
        state.api.pushHistory?.("snap-half-block");
        return true;
    }

    // --- Group / ref / other rig-driven selection: snap the rig/root position. ---
    const rig = state.activeRig;

    rig.position.set(
        snapHalfCentered(rig.position.x),
        snapHalfCentered(rig.position.y),
        snapHalfCentered(rig.position.z)
    );

    rig.updateMatrixWorld(true);

    if (state.selectionIsTempRig && rig === state.selectionRig) {
        state.api.bakeRigToMeshes?.();
        state.api.rebuildSelectionRig?.();
    }

    if (state.selectedRefId && state.activeRig) {
        fillTransformUI(state, state.activeRig);
    } else if (state.selectionBase && state.activeRig && !state.selectionIsTempRig) {
        fillTransformUIRelative(state, state.activeRig, state.selectionBase);
    }

    state.api.updateHighlight?.();
    state.api.pushHistory?.("snap-half-block");
    return true;
}

function updateSnaps(state, transform) {
    // translation snapping is handled manually so group motion is incremental
    // from the drag start instead of locking to the global 0.25 grid.
    transform.setTranslationSnap(null);
    transform.setRotationSnap(null); // we do absolute snapping ourselves
}

function updateOrbitEnabled(state, transform) {
    if (!state.orbit) return;
    state.orbit.enabled = !(state.isTransforming || transform.dragging || state.isDraggingMesh || state.isDraggingRef);
}

function killGizmoWiresHard(transform) {
    transform.traverse((o) => {
        if (o.type === "Line" || o.type === "LineSegments") o.visible = false;
        if (o.type === "Mesh") {
            const nn = (o.name || "").toUpperCase();
            if (nn.includes("HELPER") || nn.includes("START") || nn.includes("END") || nn.includes("DELTA")) {
                o.visible = false;
            }
        }
    });
}

function snapRotationAbsolute(obj, stepDeg) {
    const e = new THREE.Euler().setFromQuaternion(obj.quaternion, "XYZ");
    const sx = Math.round(THREE.MathUtils.radToDeg(e.x) / stepDeg) * stepDeg;
    const sy = Math.round(THREE.MathUtils.radToDeg(e.y) / stepDeg) * stepDeg;
    const sz = Math.round(THREE.MathUtils.radToDeg(e.z) / stepDeg) * stepDeg;

    e.set(
        THREE.MathUtils.degToRad(sx),
        THREE.MathUtils.degToRad(sy),
        THREE.MathUtils.degToRad(sz),
        "XYZ"
    );
    obj.quaternion.setFromEuler(e);
}

function safeRatio(a, b) {
    if (Math.abs(b) < 1e-8) return 1;
    return a / b;
}

/** -------------------- Numeric UI -------------------- */

function hookNumericUI(state) {
    const { px, py, pz, rx, ry, rz, sx, sy, sz } = state.ui;
    const inputs = [px, py, pz, rx, ry, rz, sx, sy, sz].filter(Boolean);

    for (const el of inputs) {
        blockNonNumericTyping(el);

        el.addEventListener("input", () => {
            sanitizeNumberInput(el, {final: false});
        });

        el.addEventListener("change", () => applyTransformFromUI(state));
        el.addEventListener("blur", () => applyTransformFromUI(state));
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                applyTransformFromUI(state);
                el.blur();
            }
        });
    }
}

function degToRad(d) {
    return (d * Math.PI) / 180;
}

function setEulerDegQuaternion(ex, ey, ez) {
    const e = new THREE.Euler(degToRad(ex), degToRad(ey), degToRad(ez), "YXZ");
    const q = new THREE.Quaternion();
    q.setFromEuler(e);
    return q;
}

export function fillTransformUI(state, obj) {
    const { px, py, pz, rx, ry, rz, sx, sy, sz } = state.ui;
    if (!obj || !px) return;

    const wpos = new THREE.Vector3();
    const wquat = new THREE.Quaternion();
    const wscale = new THREE.Vector3();

    obj.updateMatrixWorld(true);
    obj.getWorldPosition(wpos);
    obj.getWorldQuaternion(wquat);
    obj.getWorldScale(wscale);

    px.value = wpos.x.toFixed(3);
    py.value = wpos.y.toFixed(3);
    pz.value = wpos.z.toFixed(3);

    const e = new THREE.Euler().setFromQuaternion(wquat, "XYZ");
    rx.value = THREE.MathUtils.radToDeg(e.x).toFixed(1);
    ry.value = THREE.MathUtils.radToDeg(e.y).toFixed(1);
    rz.value = THREE.MathUtils.radToDeg(e.z).toFixed(1);

    sx.value = wscale.x.toFixed(3);
    sy.value = wscale.y.toFixed(3);
    sz.value = wscale.z.toFixed(3);
}

export function fillTransformUIRelative(state, obj, base) {
    const { px, py, pz, rx, ry, rz, sx, sy, sz } = state.ui;
    if (!obj || !base || !px) return;

    const wpos = new THREE.Vector3();
    const wquat = new THREE.Quaternion();
    const wscale = new THREE.Vector3();

    obj.updateMatrixWorld(true);
    obj.getWorldPosition(wpos);
    obj.getWorldQuaternion(wquat);

    const sn = obj.userData?.scaleNode || obj;
    sn.updateMatrixWorld(true);
    sn.getWorldScale(wscale);

    const dq = base.quat.clone().invert().multiply(wquat);
    const de = new THREE.Euler().setFromQuaternion(dq, "XYZ");

    const rdeg = {
        x: THREE.MathUtils.radToDeg(de.x),
        y: THREE.MathUtils.radToDeg(de.y),
        z: THREE.MathUtils.radToDeg(de.z),
    };

    const rscale = new THREE.Vector3(
        safeRatio(wscale.x, base.scale.x),
        safeRatio(wscale.y, base.scale.y),
        safeRatio(wscale.z, base.scale.z)
    );

    px.value = wpos.x.toFixed(3);
    py.value = wpos.y.toFixed(3);
    pz.value = wpos.z.toFixed(3);

    rx.value = rdeg.x.toFixed(1);
    ry.value = rdeg.y.toFixed(1);
    rz.value = rdeg.z.toFixed(1);

    sx.value = rscale.x.toFixed(3);
    sy.value = rscale.y.toFixed(3);
    sz.value = rscale.z.toFixed(3);
}

function applyTransformFromUI(state) {
    const { px, py, pz, rx, ry, rz, sx, sy, sz } = state.ui;

    const refEdit = !!state.selectedRefId && state.activeRig;
    const single = state.selectedIds.size === 1 && !state.selectedRefId;
    const exactGroup = state.api.exactGroupForSelection?.();
    const groupEdit = !!exactGroup;

    if (!single && !groupEdit && !refEdit) return;

    if (refEdit) {
        state.activeRig.position.set(
            parseFloat(px.value) || 0,
            parseFloat(py.value) || 0,
            parseFloat(pz.value) || 0
        );

        const q = setEulerDegQuaternion(
            parseFloat(rx.value) || 0,
            parseFloat(ry.value) || 0,
            parseFloat(rz.value) || 0
        );
        state.activeRig.quaternion.copy(q);

        state.activeRig.scale.set(
            parseFloat(sx.value) || 1,
            parseFloat(sy.value) || 1,
            parseFloat(sz.value) || 1
        );

        state.activeRig.updateMatrixWorld(true);
        state.api.pushHistory?.("numeric-ref");
        return;
    }

    if (single) {
        const mesh = state.api.getOnlySelectedMesh?.();
        if (!mesh) return;

        const wpos = new THREE.Vector3(
            parseFloat(px.value) || 0,
            parseFloat(py.value) || 0,
            parseFloat(pz.value) || 0
        );

        const wquat = setEulerDegQuaternion(
            parseFloat(rx.value) || 0,
            parseFloat(ry.value) || 0,
            parseFloat(rz.value) || 0
        );

        const wscale = new THREE.Vector3(
            parseFloat(sx.value) || 1,
            parseFloat(sy.value) || 1,
            parseFloat(sz.value) || 1
        );

        const world = new THREE.Matrix4().compose(wpos, wquat, wscale);
        setObjectWorldMatrix(mesh, world);

        state.api.rebuildSelectionRig?.();
        state.api.pushHistory?.("numeric");
        return;
    }

    // group edit
    if (!state.activeRig || !state.selectionBase) return;

    const ax = parseFloat(px.value);
    const ay = parseFloat(py.value);
    const az = parseFloat(pz.value);

    const drx = degToRad(parseFloat(rx.value) || 0);
    const dry = degToRad(parseFloat(ry.value) || 0);
    const drz = degToRad(parseFloat(rz.value) || 0);

    const rsx = parseFloat(sx.value) || 1;
    const rsy = parseFloat(sy.value) || 1;
    const rsz = parseFloat(sz.value) || 1;

    if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az)) {
        state.activeRig.position.set(ax, ay, az);
    }

    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(drx, dry, drz, "XYZ"));
    state.activeRig.quaternion.copy(state.selectionBase.quat).multiply(dq);

    const sn = state.activeRig.userData?.scaleNode || state.activeRig;
    sn.scale.set(
        state.selectionBase.scale.x * rsx,
        state.selectionBase.scale.y * rsy,
        state.selectionBase.scale.z * rsz
    );

    state.activeRig.updateMatrixWorld(true);
    state.api.pushHistory?.("numeric");
}

function updateVisibleTransformRows(state, transform) {
    const mode = transform?.getMode?.() || "translate";

    if (state.ui.posRow) {
        state.ui.posRow.style.display = mode === "translate" ? "flex" : "none";
    }

    if (state.ui.rotRow) {
        state.ui.rotRow.style.display = mode === "rotate" ? "flex" : "none";
    }

    if (state.ui.scaleRow) {
        state.ui.scaleRow.style.display = mode === "scale" ? "flex" : "none";
    }
}

function commitFocusedMetaInput(state) {
    const a = document.activeElement;
    if (!a) return;

    const metaInputs = [
        state.ui.tagsInput,
        state.ui.viewRangeInput,
        state.ui.blockLightInput,
        state.ui.skyLightInput,
        state.ui.shadowRadiusInput,
        state.ui.shadowStrengthInput,
    ].filter(Boolean);

    if (!metaInputs.includes(a)) return;

    applyMetaFromUI(state);
    a.blur();
}

function commitFocusedTransformInput(state) {
    const a = document.activeElement;
    if (!a) return;

    const transformInputs = [
        state.ui.px, state.ui.py, state.ui.pz,
        state.ui.rx, state.ui.ry, state.ui.rz,
        state.ui.sx, state.ui.sy, state.ui.sz
    ].filter(Boolean);

    if (!transformInputs.includes(a)) return;

    applyTransformFromUI(state);
    a.blur();
}

/** -------------------- Copy / Paste -------------------- */

function doCopy(state) {
    const exactGroup = state.api.exactGroupForSelection?.();
    if (exactGroup) {
        const g = state.api.serializeSelectedGroup?.();
        if (!g) return;
        flashBtnText(state.ui.copyBtn, "Copied", "Copy");
        state.multiClipboard = null;
        state.groupClipboard = g;
        state.blockClipboard = null;
        state.refClipboard = null;
        return;
    }

    const multi = state.api.serializeSelectedMulti?.();
    if (multi) {
        flashBtnText(state.ui.copyBtn, "Copied", "Copy");
        state.multiClipboard = multi;
        state.blockClipboard = null;
        state.groupClipboard = null;
        state.refClipboard = null;
        return;
    }

    const b = state.api.serializeSelectedBlock?.();
    if (b) {
        flashBtnText(state.ui.copyBtn, "Copied", "Copy");
        state.multiClipboard = null;
        state.blockClipboard = b;
        state.refClipboard = null;
        state.groupClipboard = null;
        return;
    }

    if (state.selectedRefId) {
        const r = state.api.serializeSelectedRef?.();
        if (!r) return;
        flashBtnText(state.ui.copyBtn, "Copied", "Copy");
        state.multiClipboard = null;
        state.refClipboard = r;
        state.blockClipboard = null;
        state.groupClipboard = null;
        return;
    }

}

function doPaste(state, offset = true) {
    if (state.groupClipboard) {
        flashBtnText(state.ui.pasteBtn, "Pasted", "Paste");
        state.api.pasteGroupFromClipboard?.(offset);
        return;
    }
    if (state.multiClipboard) {
        flashBtnText(state.ui.pasteBtn, "Pasted", "Paste");
        state.api.pasteMultiFromClipboard?.(offset);
        return;
    }
    if (state.blockClipboard) {
        flashBtnText(state.ui.pasteBtn, "Pasted", "Paste");
        state.api.pasteBlockFromClipboard?.(offset);
        return;
    }
    if (state.refClipboard) {
        flashBtnText(state.ui.pasteBtn, "Pasted", "Paste");
        state.api.pasteRefFromClipboard?.(offset);
        return;
    }
}

function flashBtnText(btn, flashText, revertText, delay = 500) {
    if (!btn) return;

    btn.innerText = flashText;

    clearTimeout(btn._flashTimeout);

    btn._flashTimeout = setTimeout(() => {
        btn.innerText = revertText;
    }, delay);
}

function isMetaInputFocused(state) {
    const a = document.activeElement;
    if (!a) return false;

    return [
        state.ui.tagsInput,
        state.ui.viewRangeInput,
        state.ui.blockLightInput,
        state.ui.skyLightInput,
        state.ui.shadowRadiusInput,
        state.ui.shadowStrengthInput,
    ].filter(Boolean).includes(a);
}

function isTextInputFocused() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = a.tagName ? a.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea") return true;
    if (a.isContentEditable) return true;
    return false;
}
