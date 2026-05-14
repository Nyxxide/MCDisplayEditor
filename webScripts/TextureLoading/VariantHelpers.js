function normalizeProps(props) {
    if (!props) return null;
    const out = {};
    for (const [k, v] of Object.entries(props)) {
        // normalize everything to string because blockstate keys are strings like "age=7"
        out[k] = String(v);
    }
    return out;
}

function keyMatchesProps(variantKey, props) {
    // variantKey like: "age=7" or "facing=north,lit=false"
    // props is normalized {age:"7", facing:"north"}
    if (variantKey === "") return true;

    const parts = variantKey.split(",");
    for (const part of parts) {
        const [k, v] = part.split("=");
        if (!k) continue;
        if (props[k] === undefined) return false;
        if (props[k] !== v) return false;
    }
    return true;
}

// For cases where you have props subset, prefer the "most specific" key (most conditions)
function pickBestMatchingVariant(vars, props) {
    let bestKey = null;
    let bestScore = -1;

    for (const key of Object.keys(vars)) {
        if (!keyMatchesProps(key, props)) continue;

        const parts = key === "" ? [] : key.split(",");

        // Prefer the variant that matches the most explicit properties.
        let score = parts.length * 10;

        // Extra preference for exact keys using all supplied props.
        const keyProps = new Set(
            parts
                .map((p) => p.split("=")[0])
                .filter(Boolean)
        );

        for (const propName of Object.keys(props || {})) {
            if (keyProps.has(propName)) score += 1;
        }

        if (score > bestScore) {
            bestScore = score;
            bestKey = key;
        }
    }

    return bestKey;
}

function getVariantModelId(blockstateJson, props = null, blockId = null) {
    const vars = blockstateJson?.variants;
    if (!vars) return null;

    const nprops = normalizeProps(props);

    // 1) If props were provided, try to match the exact/most-specific variant FIRST.
    if (nprops) {
        const bestKey = pickBestMatchingVariant(vars, nprops);
        if (bestKey != null) {
            const v = vars[bestKey];
            const first = Array.isArray(v) ? v[0] : v;
            return first && typeof first === "object" ? first : null;
        }
    }

    const entries = Object.entries(vars);

    const pickVariant = (v) => {
        const first = Array.isArray(v) ? v[0] : v;
        return first && typeof first === "object" ? first : null; // {model,x,y,uvlock,weight}
    };

    const pickByKey = (key) => (vars[key] ? pickVariant(vars[key]) : null);

    // -----------------------------
    // 0) Exact default variant
    // -----------------------------
    if (vars[""]) return pickVariant(vars[""]);

    // -----------------------------
    // 0.5) Hard defaults for editor placement (beats scoring)
    // -----------------------------
    const hardPick = (key) => (vars[key] ? pickVariant(vars[key]) : null);

    // Buttons: prefer wall + south + unpowered
    {
        const v =
            hardPick("face=wall,facing=north,powered=false") ||
            hardPick("face=wall,facing=north,powered=true");
        if (v) return v;
    }

    // Stairs: prefer south + bottom + straight
    {
        const v =
            hardPick("facing=north,half=bottom,shape=straight") ||
            hardPick("facing=north,half=bottom,shape=straight,waterlogged=false");
        if (v) return v;
    }


    // Utility: scoring for "default-looking" keys
    // Higher score = better default.
    const scoreKey = (k) => {
        let s = 0;

        // Prefer explicit "normal" defaults
        if (k.includes("waterlogged=false")) s += 50;
        if (k.includes("powered=false")) s += 40;
        if (k.includes("open=false")) s += 25;
        if (k.includes("lit=false")) s += 10;
        if (k.includes("enabled=true")) s += 10;
        if (k.includes("persistent=false")) s += 5;

        // Prefer non-special forms
        if (k.includes("snowy=false")) s += 3;

        // Avoid “special” / odd states
        if (k.includes("waterlogged=true")) s -= 100;
        if (k.includes("powered=true")) s -= 50;
        if (k.includes("open=true")) s -= 20;
        if (k.includes("lit=true")) s -= 5;

        // Avoid rail ascents unless explicitly desired
        if (k.includes("ascending")) s -= 40;

        // Avoid weird shapes
        if (k.includes("shape=inner") || k.includes("shape=outer")) s -= 20;
        if (k.includes("shape=left") || k.includes("shape=right")) s -= 20;

        return s;
    };

    const bestMatch = (predicate) => {
        let best = null;
        let bestScore = -Infinity;

        for (const [k, v] of entries) {
            if (!predicate(k)) continue;
            const s = scoreKey(k);
            if (s > bestScore) {
                bestScore = s;
                best = v;
            }
        }
        return best ? pickVariant(best) : null;
    };

    // -----------------------------
    // 1) Logs / columns: axis=y
    // -----------------------------
    {
        const v =
            pickByKey("axis=y") ||
            pickByKey("axis=y,waterlogged=false") ||
            pickByKey("axis=y,waterlogged=true");
        if (v) return v;
    }

    // -----------------------------
    // 2) Stairs: straight + bottom + facing=south preferred
    // -----------------------------
    {
        const v =
            bestMatch(
                (k) =>
                    k.includes("shape=straight") &&
                    k.includes("half=bottom") &&
                    k.includes("facing=north")
            ) ||
            bestMatch(
                (k) =>
                    k.includes("shape=straight") &&
                    k.includes("half=bottom")
            ) ||
            bestMatch((k) => k.includes("shape=straight")); // last resort for stairs-like
        if (v) return v;
    }

    // -----------------------------
    // 3) Slabs: bottom
    // -----------------------------
    {
        const v = bestMatch((k) => k.includes("type=bottom"));
        if (v) return v;
    }

    // -----------------------------
    // 4) Buttons: wall + facing=south preferred
    // -----------------------------
    {
        // 4) Buttons: strongly prefer wall + powered=false + facing=south
        {
            const v =
                bestMatch(k => k.includes("face=wall") && k.includes("powered=false") && k.includes("facing=north")) ||
                bestMatch(k => k.includes("face=wall") && k.includes("powered=false")) ||
                bestMatch(k => k.includes("face=wall")) ||
                bestMatch(k => k.includes("powered=false")); // last resort, but still better than random
            if (v) return v;
        }

    }

    // -----------------------------
    // 5) Rails: flat north_south preferred, non-ascending otherwise
    // -----------------------------
    {
        const v =
            bestMatch((k) => k.includes("shape=north_south")) ||
            bestMatch(
                (k) =>
                    k.includes("shape=") &&
                    !k.includes("ascending")
            );
        if (v) return v;
    }

    // -----------------------------
    // 6) Big dripleaf: tilt=none, facing=south preferred
    // -----------------------------
    {
        const v =
            bestMatch(
                (k) =>
                    k.includes("tilt=none") &&
                    k.includes("facing=north")
            ) ||
            bestMatch((k) => k.includes("tilt=none"));
        if (v) return v;
    }

    // -----------------------------
    // 7) Hopper: facing=down preferred
    // -----------------------------
    {
        const v = bestMatch((k) => k.includes("facing=down"));
        if (v) return v;
    }

    // -----------------------------
    // 8) Generic facing blocks: prefer facing=south (your editor default),
    //    otherwise facing=north, otherwise any facing.
    // -----------------------------
    {
        const v =
            bestMatch((k) => k.includes("facing=north")) ||
            bestMatch((k) => k.includes("facing=south")) ||
            bestMatch((k) => k.includes("facing="));
        if (v) return v;
    }

    // -----------------------------
    // 9) Final fallback: best-scored variant overall
    // -----------------------------
    {
        let bestK = null;
        let bestScore = -Infinity;

        for (const [k] of entries) {
            const s = scoreKey(k);
            if (s > bestScore) {
                bestScore = s;
                bestK = k;
            }
        }

        if (bestK != null) return pickVariant(vars[bestK]);
    }

    // Absolute fallback
    const first = entries[0];
    return first ? pickVariant(first[1]) : null;
}

export {getVariantModelId}