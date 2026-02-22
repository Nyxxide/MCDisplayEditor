import * as THREE from "three";

export async function loadMcmetaAnimatedTexture(pngUrl, mcmetaUrl) {
    const loader = new THREE.TextureLoader();

    // Load texture
    const tex = await new Promise((resolve, reject) => {
        loader.load(
            pngUrl,
            (t) => resolve(t),
            undefined,
            (e) => reject(e)
        );
    });

    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;

    // Load mcmeta
    const mc = await fetch(mcmetaUrl).then(r => {
        if (!r.ok) throw new Error(`Failed to load mcmeta: ${mcmetaUrl}`);
        return r.json();
    });

    const anim = mc.animation || {};
    const frametime = anim.frametime ?? 1; // ticks (20/s) in MC
    const interpolate = !!anim.interpolate;
    const framesSpec = anim.frames; // optional list

    // Determine frame geometry
    // Minecraft assumes vertical strips unless you specify something else (it doesn't in mcmeta).
    const img = tex.image;
    const frameW = img.width;
    const frameH = img.width; // usually square frames
    const frameCount = Math.floor(img.height / frameH);

    // Build a per-frame duration list (in ticks)
    let frames = [];
    if (Array.isArray(framesSpec) && framesSpec.length) {
        frames = framesSpec.map(f => {
            if (typeof f === "number") return { index: f, time: frametime };
            return { index: f.index ?? 0, time: f.time ?? frametime };
        });
    } else {
        frames = Array.from({ length: frameCount }, (_, i) => ({ index: i, time: frametime }));
    }

    // Set repeat to show exactly one frame slice
    tex.repeat.set(1, frameH / img.height);

    // Animator state
    const state = {
        tex,
        frames,
        interpolate,
        // total duration in ticks
        totalTicks: frames.reduce((a, f) => a + f.time, 0),
        // internal time accumulator in ticks
        t: 0,
        frameH,
        imgH: img.height
    };

    // Set initial frame (index 0)
    setFrameByIndex(state, frames[0].index);

    return state;
}

function setFrameByIndex(st, frameIndex) {
    // frameIndex 0 = top frame in the PNG
    const v = 1 - (frameIndex + 1) * (st.frameH / st.imgH);
    st.tex.offset.set(0, v);
    st.tex.needsUpdate = true;
}

export function tickMcmetaAnimator(st, dtSeconds) {
    // Minecraft tick = 1/20 sec
    const dtTicks = dtSeconds * 20;
    st.t = (st.t + dtTicks) % st.totalTicks;

    // Find current frame
    let acc = 0;
    for (let i = 0; i < st.frames.length; i++) {
        const f = st.frames[i];
        acc += f.time;
        if (st.t < acc) {
            setFrameByIndex(st, f.index);
            break;
        }
    }
}
