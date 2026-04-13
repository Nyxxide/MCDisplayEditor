import * as THREE from "three";
import {updateFacingCompass} from "../Misc/CompassSetup.js";

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
        imgH: img.height,
        flipX: false,
        flipY: false
    };

    // Set initial frame (index 0)
    setFrameByIndex(state, frames[0].index);

    return state;
}

function setFrameByIndex(st, frameIndex) {
    const frameV = st.frameH / st.imgH;

    // Horizontal
    const repeatX = st.flipX ? -1 : 1;
    const offsetX = st.flipX ? 1 : 0;

    // Vertical frame window
    // frameIndex 0 = top frame in PNG
    const v0 = 1 - (frameIndex + 1) * frameV; // bottom of selected frame in UV space
    const v1 = v0 + frameV;                   // top of selected frame in UV space

    const repeatY = st.flipY ? -frameV : frameV;
    const offsetY = st.flipY ? v1 : v0;

    st.tex.repeat.set(repeatX, repeatY);
    st.tex.offset.set(offsetX, offsetY);
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

export function setMcmetaAnimatorFlip(st, flipX = false, flipY = false) {
    st.flipX = flipX;
    st.flipY = flipY;

    // Re-apply current frame immediately
    let acc = 0;
    for (let i = 0; i < st.frames.length; i++) {
        const f = st.frames[i];
        acc += f.time;
        if (st.t < acc) {
            setFrameByIndex(st, f.index);
            return;
        }
    }

    // fallback
    setFrameByIndex(st, st.frames[0].index);
}

export async function initAnimations(state, clock) {

    let markerAnim = null;
    let markerMesh = null;

// --- Command block marker (animated) ---
    markerAnim = await loadMcmetaAnimatedTexture(
        "/Resources/textures/block/command_block_front.png",
        "/Resources/textures/block/command_block_front.png.mcmeta"
    );

    setMcmetaAnimatorFlip(markerAnim, true, true);

    const markerMat = new THREE.MeshBasicMaterial({
        map: markerAnim.tex,
        transparent: true
    });

    markerMat.toneMapped = false;


    markerMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), markerMat);

// flat on ground, slightly raised to avoid z-fighting
    markerMesh.rotation.x = -Math.PI / 2;
    markerMesh.position.set(0, 0.001, 0);

// optional: fight z-fighting even harder
    markerMat.polygonOffset = true;
    markerMat.polygonOffsetFactor = -1;
    markerMat.polygonOffsetUnits = -1;

    (state.floorOriginRoot || state.scene).add(markerMesh);
    state.debug.floorMarkerMesh = markerMesh;

    function animate() {
        const dt = clock.getDelta();

        if (markerAnim) tickMcmetaAnimator(markerAnim, dt);

        state.orbit.update();
        updateFacingCompass();
        state.composer.render();

        // render gizmo scene after
        state.renderer.autoClear = false;
        state.renderer.clearDepth();
        state.renderer.render(state.gizmoScene, state.camera);
        state.renderer.autoClear = true;


        requestAnimationFrame(animate);
    }
    animate();

}