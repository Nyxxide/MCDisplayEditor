import * as THREE from 'three';

import { remapUVsToRect } from "./UVRectHelpers.js";
import { attachCollidersFromChildMeshes } from "./ColliderMetadata.js";


//Constants

const _extTexCache = new Map();

const FACE = {
    RIGHT: 0,  // +X (east)
    LEFT:  1,  // -X (west)
    TOP:   2,  // +Y (up)
    BOTTOM:3,  // -Y (down)
    FRONT: 4,  // +Z (south)
    BACK:  5,  // -Z (north)
};



//Helpers

async function loadExternalTexture(url) {
    if (_extTexCache.has(url)) return _extTexCache.get(url);

    const p = (async () => {
        const loader = new THREE.ImageBitmapLoader();
        const bmp = await loader.loadAsync(url);

        const tex = new THREE.Texture(bmp);
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        return tex;
    })();

    _extTexCache.set(url, p);
    return p;
}

function stripBoxFaces(nonIndexedBoxGeom, facesToRemove /* array of FACE.* */) {
    const g = nonIndexedBoxGeom;
    const pos = g.attributes.position.array;
    const uv  = g.attributes.uv.array;

    const keep = new Array(6).fill(true);
    for (const f of facesToRemove) keep[f] = false;

    const newPos = [];
    const newUv  = [];

    // each face = 6 vertices, each vertex = 3 pos floats, 2 uv floats
    for (let face = 0; face < 6; face++) {
        if (!keep[face]) continue;

        const vStart = face * 6;

        for (let i = 0; i < 6; i++) {
            const vi = vStart + i;

            newPos.push(
                pos[vi * 3 + 0],
                pos[vi * 3 + 1],
                pos[vi * 3 + 2],
            );

            newUv.push(
                uv[vi * 2 + 0],
                uv[vi * 2 + 1],
            );
        }
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(newPos, 3));
    out.setAttribute("uv", new THREE.Float32BufferAttribute(newUv, 2));
    out.computeVertexNormals();
    return out;
}

function makeEndPortalShaderMaterial(tex, {
    layers = [],
    opacity = 0.95,
    contrast = 1.25,
    brightness = 1.0,
} = {}) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    const layerCount = Math.min(layers.length, 8);

    const uniforms = {
        map: { value: tex },
        time: { value: 0 },
        opacity: { value: opacity },
        contrast: { value: contrast },
        brightness: { value: brightness },
        layerCount: { value: layerCount },
    };

    for (let i = 0; i < 8; i++) {
        const l = layers[i] || {
            tint: new THREE.Color(0x000000),
            speedX: 0,
            speedY: 0,
            scale: 1,
            alpha: 0,
        };

        uniforms[`tints${i}`] = { value: l.tint };
        uniforms[`speeds${i}`] = { value: new THREE.Vector2(l.speedX, l.speedY) };
        uniforms[`scales${i}`] = { value: l.scale };
        uniforms[`alphas${i}`] = { value: l.alpha };
    }

    const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
            varying vec4 vScreenPos;

            void main() {
                vScreenPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_Position = vScreenPos;
            }
        `,
        fragmentShader: `
            uniform sampler2D map;
            uniform float time;
            uniform float opacity;
            uniform float contrast;
            uniform float brightness;
            uniform int layerCount;

            uniform vec3 tints0;
            uniform vec3 tints1;
            uniform vec3 tints2;
            uniform vec3 tints3;
            uniform vec3 tints4;
            uniform vec3 tints5;
            uniform vec3 tints6;
            uniform vec3 tints7;

            uniform vec2 speeds0;
            uniform vec2 speeds1;
            uniform vec2 speeds2;
            uniform vec2 speeds3;
            uniform vec2 speeds4;
            uniform vec2 speeds5;
            uniform vec2 speeds6;
            uniform vec2 speeds7;

            uniform float scales0;
            uniform float scales1;
            uniform float scales2;
            uniform float scales3;
            uniform float scales4;
            uniform float scales5;
            uniform float scales6;
            uniform float scales7;

            uniform float alphas0;
            uniform float alphas1;
            uniform float alphas2;
            uniform float alphas3;
            uniform float alphas4;
            uniform float alphas5;
            uniform float alphas6;
            uniform float alphas7;

            varying vec4 vScreenPos;

            vec3 getTint(int i) {
                if (i == 0) return tints0;
                if (i == 1) return tints1;
                if (i == 2) return tints2;
                if (i == 3) return tints3;
                if (i == 4) return tints4;
                if (i == 5) return tints5;
                if (i == 6) return tints6;
                return tints7;
            }

            vec2 getSpeed(int i) {
                if (i == 0) return speeds0;
                if (i == 1) return speeds1;
                if (i == 2) return speeds2;
                if (i == 3) return speeds3;
                if (i == 4) return speeds4;
                if (i == 5) return speeds5;
                if (i == 6) return speeds6;
                return speeds7;
            }

            float getScale(int i) {
                if (i == 0) return scales0;
                if (i == 1) return scales1;
                if (i == 2) return scales2;
                if (i == 3) return scales3;
                if (i == 4) return scales4;
                if (i == 5) return scales5;
                if (i == 6) return scales6;
                return scales7;
            }

            float getAlpha(int i) {
                if (i == 0) return alphas0;
                if (i == 1) return alphas1;
                if (i == 2) return alphas2;
                if (i == 3) return alphas3;
                if (i == 4) return alphas4;
                if (i == 5) return alphas5;
                if (i == 6) return alphas6;
                return alphas7;
            }

            void main() {
                vec2 screenUV = vScreenPos.xy / vScreenPos.w;
                screenUV = screenUV * 0.5 + 0.5;

                vec3 col = vec3(0.0);

                for (int i = 0; i < 8; i++) {
                    if (i >= layerCount) break;

                    float sc = getScale(i);
                    vec2 spd = getSpeed(i);
                    float a = getAlpha(i);
                    vec3 tint = getTint(i);

                    vec2 uv = screenUV * sc / 256.0;
                    uv += spd * time;

                    vec4 sampleCol = texture2D(map, uv);

                    float star = max(max(sampleCol.r, sampleCol.g), sampleCol.b);

                    // keep dim background texture visible instead of only bright pixels
                    vec3 layer = mix(sampleCol.rgb * tint * 0.75, tint, star * 0.55);
                    
                    col += layer * a;
                }

                col *= brightness;
                col = clamp(col, 0.0, 1.0);

                gl_FragColor = vec4(col, opacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
    });

    mat.toneMapped = false;
    mat.userData.isEndPortalShader = true;

    return mat;
}


//Apply Faces Helpers

function applyModelRendererCubeUVs(geom, texU, texV, w, h, d, texW = 64, texH = 32, mirrorSides = false) {
    const rect = (x, y, W, H) => ({
        u0: x / texW,
        v0: y / texH,
        u1: (x + W) / texW,
        v1: (y + H) / texH,
    });

    // Vanilla ModelRenderer layout
    const up    = rect(texU + d,         texV,       w, d);
    const down  = rect(texU + d + w,     texV,       w, d);

    const west  = rect(texU,             texV + d,   d, h);
    const north = rect(texU + d,         texV + d,   w, h);
    const east  = rect(texU + d + w,     texV + d,   d, h);
    const south = rect(texU + d + w + d, texV + d,   w, h);

    const remapFace = (face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    // Your convention: FRONT = +Z (south), BACK = -Z (north)
    remapFace(FACE.RIGHT,  east,  mirrorSides, true);
    remapFace(FACE.LEFT,   west,  mirrorSides, true);
    remapFace(FACE.FRONT,  north, mirrorSides, true);
    remapFace(FACE.BACK,   south, mirrorSides, true);

    // IMPORTANT: for heads, DO NOT swap top/bottom like chest.
    remapFace(FACE.TOP,    up,    false, true);
    remapFace(FACE.BOTTOM, down,  false, false);
}

function applyModelRendererBoxUVs(geom, texU, texV, w, h, d, texW = 64, texH = 64) {
    const rect = (x, y, W, H) => ({
        u0: x / texW,
        v0: y / texH,
        u1: (x + W) / texW,
        v1: (y + H) / texH,
    });

    // ModelRenderer-style layout
    const up    = rect(texU + d,       texV,         w, d);
    const down  = rect(texU + d + w,   texV,         w, d);

    const west  = rect(texU,           texV + d,     d, h);
    const north = rect(texU + d,       texV + d,     w, h);
    const east  = rect(texU + d + w,   texV + d,     d, h);
    const south = rect(texU + d + w + d, texV + d,   w, h);

    const MIRROR = true

    const remapFace = (face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    // If you want chest sides mirrored horizontally, flipU=true for the vertical faces:
    const MIRROR_SIDES = true;

    remapFace(FACE.RIGHT,  east,  MIRROR_SIDES);
    remapFace(FACE.LEFT,   west,  MIRROR_SIDES);
    remapFace(FACE.FRONT,  south, MIRROR_SIDES);
    remapFace(FACE.BACK,   north, MIRROR_SIDES);

    remapFace(FACE.TOP,    down,  false);
    remapFace(FACE.BOTTOM, up,    false);
}

function remapUVsToRectRot90(geom, faceIndex, u0, v0, u1, v1, turnsCW = 1) {
    const uv = geom.attributes.uv;
    const start = faceIndex * 6;

    const corners = [
        [u0, v1], // bottom-left
        [u1, v1], // bottom-right
        [u0, v0], // top-left
        [u1, v0], // top-right
    ];

    const rot = ((turnsCW % 4) + 4) % 4;

    let rotated;
    if (rot === 0) {
        rotated = corners;
    } else if (rot === 1) {
        rotated = [
            corners[2],
            corners[0],
            corners[3],
            corners[1],
        ];
    } else if (rot === 2) {
        rotated = [
            corners[3],
            corners[2],
            corners[1],
            corners[0],
        ];
    } else {
        rotated = [
            corners[1],
            corners[3],
            corners[0],
            corners[2],
        ];
    }

    const bl = rotated[0];
    const br = rotated[1];
    const tl = rotated[2];
    const tr = rotated[3];

    const tri = [
        bl, tl, br,
        tl, tr, br,
    ];

    for (let i = 0; i < 6; i++) {
        uv.setXY(start + i, tri[i][0], tri[i][1]);
    }

    uv.needsUpdate = true;
}



//Build Special Block Textures

function makeSingleChestMesh(chestTex) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    function makeBox(from, to, texU, texV, uvDims /* {w,h,d} */, removeFaces = []) {
        const wG = (to[0] - from[0]);
        const hG = (to[1] - from[1]);
        const dG = (to[2] - from[2]);

        const sx = wG / 16, sy = hG / 16, sz = dG / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const raw = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();

        // unwrap ONCE, using actual w/h/d from the box
        applyModelRendererBoxUVs(raw, texU, texV, uvDims.w, uvDims.h, uvDims.d, 64, 64);

        const g = removeFaces.length ? stripBoxFaces(raw, removeFaces) : raw;

        const m = new THREE.MeshBasicMaterial({
            map: chestTex,
            transparent: false,
            side: THREE.FrontSide,
            depthWrite: true,
            depthTest: true,
        });
        m.toneMapped = false;

        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(cx, cy, cz);
        return mesh;
    }

    const base = makeBox(
        [1, 0, 1], [15, 10, 15],
        0, 19,
        { w: 14, h: 10, d: 14 },
        [FACE.TOP]
    );

    const lid = makeBox(
        [1, 9, 1], [15, 14, 15],     // 4 tall geometry
        0, 0,
        { w: 14, h: 5, d: 14 },        // 5 tall UV layout
        [FACE.BOTTOM]
    );

    const knob = makeBox(
        [7, 7, 15], [9, 11, 16],
        0, 0,
        { w: 2, h: 4, d: 1 },
        []
    );

    inner.add(base, lid, knob);
    inner.rotateY(Math.PI);
    inner.updateMatrix();
    inner.matrixAutoUpdate = false;

    group.add(inner);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = "minecraft:chest";
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeSignMesh(signTex, id) {
    const group = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 64;
    const TEX_H = 32;

    const rect = (x, y, w, h) => ({
        u0: x / TEX_W,
        v0: y / TEX_H,
        u1: (x + w) / TEX_W,
        v1: (y + h) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        const mat = new THREE.MeshBasicMaterial({
            map: signTex,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: true,
            depthTest: true,
        });
        mat.toneMapped = false;

        return new THREE.Mesh(geom, mat);
    }

    const boardLeft   = rect(0,  2,  2, 12);
    const boardFront  = rect(2,  2, 24, 12);
    const boardRight  = rect(26, 2,  2, 12);
    const boardBack   = rect(28, 2, 24, 12);
    const boardTop    = rect(2,  0, 24,  2);
    const boardBottom = rect(26, 0, 24,  2);

    const postLeft    = rect(0, 16, 2, 14);
    const postFront   = rect(2, 16, 2, 14);
    const postRight   = rect(4, 16, 2, 14);
    const postBack    = rect(6, 16, 2, 14);
    const postTop     = rect(2, 14, 2,  2);
    const postBottom  = rect(4, 14, 2,  2);

    const post = makeBox(
        [7.5, 0.0, 7.5],
        [8.5, 9.3, 8.5]
    );

    const board = makeBox(
        [0, 9.3, 7.5],
        [16, 17.2, 8.5]
    );

    const pg = post.geometry;
    const bg = board.geometry;

    remapFace(pg, FACE.LEFT,   postLeft,   false, true);
    remapFace(pg, FACE.FRONT,  postFront,  false, true);
    remapFace(pg, FACE.RIGHT,  postRight,  false, true);
    remapFace(pg, FACE.BACK,   postBack,   false, true);

    remapFace(pg, FACE.TOP,    postTop,    false, true);
    remapFace(pg, FACE.BOTTOM, postBottom, false, false);

    remapFace(bg, FACE.LEFT,   boardLeft,   false, true);
    remapFace(bg, FACE.FRONT,  boardFront,  false, true);
    remapFace(bg, FACE.RIGHT,  boardRight,  false, true);
    remapFace(bg, FACE.BACK,   boardBack,   false, true);

    remapFace(bg, FACE.TOP,    boardTop,    false, true);
    remapFace(bg, FACE.BOTTOM, boardBottom, false, false);

    group.add(post);
    group.add(board);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeWallSignMesh(signTex, id, props = {}) {
    const facing = props?.facing;

    const group = new THREE.Group();
    const inner = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 64;
    const TEX_H = 32;

    const rect = (x, y, w, h) => ({
        u0: x / TEX_W,
        v0: y / TEX_H,
        u1: (x + w) / TEX_W,
        v1: (y + h) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        const mat = new THREE.MeshBasicMaterial({
            map: signTex,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: true,
            depthTest: true,
        });
        mat.toneMapped = false;

        return new THREE.Mesh(geom, mat);
    }

    // Same board UVs as makeSignMesh
    const boardLeft   = rect(0,  2,  2, 12);
    const boardFront  = rect(2,  2, 24, 12);
    const boardRight  = rect(26, 2,  2, 12);
    const boardBack   = rect(28, 2, 24, 12);
    const boardTop    = rect(2,  0, 24,  2);
    const boardBottom = rect(26, 0, 24,  2);

    // Board only, no post.
    // Full 16 wide, centered vertically around wall-sign height.
    // Shifted back against the south wall: z 15..16.
    const board = makeBox(
        [0, 4.35, 14.75],
        [16, 12.25, 15.75]
    );

    const bg = board.geometry;

    remapFace(bg, FACE.LEFT,   boardLeft,   false, true);
    remapFace(bg, FACE.FRONT,  boardBack,  false, true);
    remapFace(bg, FACE.RIGHT,  boardRight,  false, true);
    remapFace(bg, FACE.BACK,   boardFront,   false, true);
    remapFace(bg, FACE.TOP,    boardTop,    false, true);
    remapFace(bg, FACE.BOTTOM, boardBottom, false, false);

    inner.add(board);

    if(facing === "west") {
        inner.rotation.y = Math.PI / 2;
    }
    else if(facing === "east"){
        inner.rotation.y = -Math.PI / 2;
    }
    else if(facing === "south") {
        inner.rotation.y = Math.PI;
    }

    group.add(inner);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeHangingSignMesh(signTex, id, props = {}) {
    const attached = props?.attached === true || props?.attached === "true";

    const group = new THREE.Group();
    const inner = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 64;
    const TEX_H = 32;

    const rect = (x, y, w, h) => ({
        u0: x / TEX_W,
        v0: y / TEX_H,
        u1: (x + w) / TEX_W,
        v1: (y + h) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        return new THREE.Mesh(geom, material);
    }

    function makePlane(widthPx, heightPx, center, material, uvRect, rotY = 0, flipV = true) {
        const geom = new THREE.PlaneGeometry(widthPx / 16, heightPx / 16).toNonIndexed();

        let { u0, v0, u1, v1 } = uvRect;
        if (flipV) [v0, v1] = [v1, v0];

        remapUVsToRect(geom, 0, u0, v0, u1, v1);

        geom.rotateY(rotY);
        geom.translate(
            toBlock(center[0]),
            toBlock(center[1]),
            toBlock(center[2])
        );

        return new THREE.Mesh(geom, material);
    }

    const mat = new THREE.MeshBasicMaterial({
        map: signTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    mat.toneMapped = false;

    // Main sign board UVs
    const boardTop    = rect(2,  12, 14, 2);
    const boardBottom = rect(16, 12, 14, 2);
    const boardLeft   = rect(0,  14, 2,  10);
    const boardFront  = rect(2,  14, 14, 10);
    const boardRight  = rect(16, 14, 2,  10);
    const boardBack   = rect(18, 14, 14, 10);

    // 2D chain texture regions
    const hangingChainCross = rect(0, 6, 3, 6);
    const hangingChainMid = rect(6, 6, 3, 6)
    const attachedChainFlat = rect(14, 6, 12, 6);

    // Board: 14 wide, 10 tall, 2 thick
    const board = makeBox(
        [1, 0, 7],
        [15, 10, 9],
        mat
    );

    const bg = board.geometry;

    remapFace(bg, FACE.TOP,    boardTop,    false, true);
    remapFace(bg, FACE.BOTTOM, boardBottom, false, false);
    remapFace(bg, FACE.LEFT,   boardLeft,   false, true);
    remapFace(bg, FACE.RIGHT,  boardRight,  false, true);
    remapFace(bg, FACE.FRONT,  boardFront,  false, true);
    remapFace(bg, FACE.BACK,   boardBack,   false, true);

    inner.add(board);

    if (attached) {
        // Attached hanging sign: flatter chain strip across the top
        const flatChain = makePlane(
            12,
            6,
            [8, 13, 8],
            mat,
            attachedChainFlat,
            0
        );

        inner.add(flatChain);
    } else {
        // Normal hanging sign: two crossed chain planes
        const chainABot = makePlane(
            2.75,
            6,
            [3, 13, 8],
            mat,
            hangingChainCross,
            Math.PI / 4
        );

        const chainAMid = makePlane(
            2.75,
            6,
            [3, 13, 8],
            mat,
            hangingChainMid,
            -Math.PI / 4
        );

        const chainATop = makePlane(
            2.75,
            6,
            [3, 13, 8],
            mat,
            hangingChainCross,
            Math.PI / 4
        );

        const chainBBot = makePlane(
            2.75,
            6,
            [13, 13, 8],
            mat,
            hangingChainCross,
            Math.PI / 4
        );

        const chainBMid = makePlane(
            2.75,
            6,
            [13, 13, 8],
            mat,
            hangingChainMid,
            -Math.PI / 4
        );

        const chainBTop = makePlane(
            2.75,
            6,
            [13, 13, 8],
            mat,
            hangingChainCross,
            Math.PI / 4
        );

        inner.add(chainABot, chainAMid, chainATop, chainBBot, chainBMid, chainBTop);
    }

    // Match your other entity-block convention
    inner.rotation.y = Math.PI;

    group.add(inner);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeWallHangingSignMesh(signTex, id) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 64;
    const TEX_H = 32;

    const rect = (x, y, w, h) => ({
        u0: x / TEX_W,
        v0: y / TEX_H,
        u1: (x + w) / TEX_W,
        v1: (y + h) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        return new THREE.Mesh(geom, material);
    }

    function makePlane(widthPx, heightPx, center, material, uvRect, rotY = 0, flipV = true) {
        const geom = new THREE.PlaneGeometry(widthPx / 16, heightPx / 16).toNonIndexed();

        let { u0, v0, u1, v1 } = uvRect;
        if (flipV) [v0, v1] = [v1, v0];

        remapUVsToRect(geom, 0, u0, v0, u1, v1);

        geom.rotateY(rotY);
        geom.translate(
            toBlock(center[0]),
            toBlock(center[1]),
            toBlock(center[2])
        );

        return new THREE.Mesh(geom, material);
    }

    const mat = new THREE.MeshBasicMaterial({
        map: signTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    mat.toneMapped = false;

    // Main sign board UVs — same as base hanging sign
    const boardTop    = rect(2,  12, 14, 2);
    const boardBottom = rect(16, 12, 14, 2);
    const boardLeft   = rect(0,  14, 2,  10);
    const boardFront  = rect(2,  14, 14, 10);
    const boardRight  = rect(16, 14, 2,  10);
    const boardBack   = rect(18, 14, 14, 10);

    // Top wall bar / rod UVs
    // These are using the upper 3D-wood strip area from the texture.
    const barTop    = rect(4,  0, 16, 4);
    const barBottom = rect(20, 0, 16, 4);
    const barLeft   = rect(0,  4, 4,  2);
    const barFront  = rect(4,  4, 16, 2);
    const barRight  = rect(20, 4, 4,  2);
    const barBack   = rect(24, 4, 16, 2);

    // Chain 2D regions — same regions you tuned in makeHangingSignMesh
    const hangingChainCross = rect(0, 6, 3, 6);
    const hangingChainMid   = rect(6, 6, 3, 6);

    // Board: same 14x10x2 sign body, hanging below wall chains
    const board = makeBox(
        [1, 0, 7],
        [15, 10, 9],
        mat
    );

    const bg = board.geometry;

    remapFace(bg, FACE.TOP,    boardTop,    false, true);
    remapFace(bg, FACE.BOTTOM, boardBottom, false, false);
    remapFace(bg, FACE.LEFT,   boardLeft,   false, true);
    remapFace(bg, FACE.RIGHT,  boardRight,  false, true);
    remapFace(bg, FACE.FRONT,  boardFront,  false, true);
    remapFace(bg, FACE.BACK,   boardBack,   false, true);

    // Wall-mounted horizontal bar.
    // 16x2x2, pushed toward the south wall side.
    const wallBar = makeBox(
        [0, 14, 6],
        [16, 16, 10],
        mat
    );

    const wg = wallBar.geometry;

    remapFace(wg, FACE.TOP,    barTop,    false, true);
    remapFace(wg, FACE.BOTTOM, barBottom, false, false);
    remapFace(wg, FACE.LEFT,   barLeft,   false, true);
    remapFace(wg, FACE.RIGHT,  barRight,  false, true);
    remapFace(wg, FACE.FRONT,  barFront,  false, true);
    remapFace(wg, FACE.BACK,   barBack,   false, true);

    // Two hanging chain assemblies connecting bar down to board.
    // Positioned slightly backward toward the wall compared to base hanging sign.
    const chainABot = makePlane(
        2.75,
        6,
        [3, 13, 8],
        mat,
        hangingChainCross,
        Math.PI / 4
    );

    const chainAMid = makePlane(
        2.75,
        6,
        [3, 13, 8],
        mat,
        hangingChainMid,
        -Math.PI / 4
    );

    const chainATop = makePlane(
        2.75,
        6,
        [3, 13, 8],
        mat,
        hangingChainCross,
        Math.PI / 4
    );

    const chainBBot = makePlane(
        2.75,
        6,
        [13, 13, 8],
        mat,
        hangingChainCross,
        Math.PI / 4
    );

    const chainBMid = makePlane(
        2.75,
        6,
        [13, 13, 8],
        mat,
        hangingChainMid,
        -Math.PI / 4
    );

    const chainBTop = makePlane(
        2.75,
        6,
        [13, 13, 8],
        mat,
        hangingChainCross,
        Math.PI / 4
    );

    inner.add(
        wallBar,
        board,
        chainABot,
        chainAMid,
        chainATop,
        chainBBot,
        chainBMid,
        chainBTop
    );

    // Same convention as your hanging sign
    inner.rotation.y = Math.PI;

    group.add(inner);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeBedMesh(bedTex, id, props = {}) {
    const part = props?.part;
    const group = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 64;
    const TEX_H = 64;

    const rect = (x, y, w, h) => ({
        u0: x / TEX_W,
        v0: y / TEX_H,
        u1: (x + w) / TEX_W,
        v1: (y + h) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    const remapFaceRot90 = (geom, face, r, turnsCW = 1) => {
        remapUVsToRectRot90(geom, face, r.u0, r.v0, r.u1, r.v1, turnsCW);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);
        geom.rotateY(Math.PI);

        return new THREE.Mesh(geom, material);
    }

    const mat = new THREE.MeshBasicMaterial({
        map: bedTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
    });
    mat.toneMapped = false;

    if (part === "foot") {
        // foot half (bed block 2)
        const bed2Top    = rect(6,  28, 16, 16);
        const bed2Left   = rect(0,  28,  6, 16);
        const bed2Back  = rect(22, 22, 16,  6);
        const bed2Front   = rect(5, 53, 16, 6);
        const bed2Right  = rect(22, 28,  6, 16);
        const bed2Bottom = rect(28, 28, 16, 16);

        // legs
        const legTop    = rect(53, 0, 3, 3);
        const legBottom = rect(56, 0, 3, 3);

        const legOutside   = rect(53, 3, 3, 3);
        const legInside  = rect(56, 3, 3, 3);

        const bed2 = makeBox([0, 3, 0], [16, 9, 16],  mat);    // foot half one block north
        const g2 = bed2.geometry;

        // block 2 (foot)
        remapFace(g2, FACE.TOP,    bed2Top,    false, false);
        remapFaceRot90(g2, FACE.LEFT,  bed2Left,  3);
        remapFaceRot90(g2, FACE.RIGHT, bed2Right, 1);
        remapFace(g2, FACE.FRONT,   bed2Front,  true,  true);
        remapFace(g2, FACE.BACK,  bed2Back,  true,  false);         // north-facing visible end
        remapFace(g2, FACE.BOTTOM, bed2Bottom, false, false);

        // block 2 (left2/right2)
        const leg2L = makeBox([0, 0, 0],  [3, 3, 3], mat);
        const leg2R = makeBox([13, 0, 0], [16, 3, 3], mat);

        remapFace(leg2L.geometry, FACE.TOP, legTop, false, true);
        remapFace(leg2L.geometry, FACE.BOTTOM, legBottom, false, true);

        remapFace(leg2L.geometry, FACE.LEFT, legOutside, false, true);
        remapFace(leg2L.geometry, FACE.RIGHT, legInside, true, true);
        remapFace(leg2L.geometry, FACE.FRONT, legInside, false, true);
        remapFace(leg2L.geometry, FACE.BACK, legOutside, true, true);


        remapFace(leg2R.geometry, FACE.TOP, legTop, false, true);
        remapFace(leg2R.geometry, FACE.BOTTOM, legBottom, false, true);

        remapFace(leg2R.geometry, FACE.LEFT, legInside, false, true);
        remapFace(leg2R.geometry, FACE.RIGHT, legOutside, true, true);
        remapFace(leg2R.geometry, FACE.FRONT, legInside, true, true);
        remapFace(leg2R.geometry, FACE.BACK, legOutside, false, true);

        group.add(bed2, leg2L, leg2R);
    }
    else if (part === "head") {
        // head/pillow half (bed block 1)
        const bed1Top    = rect(6,  6, 16, 16);
        const bed1Left   = rect(0,  6,  6, 16);
        const bed1Front   = rect(6,  0, 16,  6);
        const bed1Back  = rect(5, 53, 16, 6);
        const bed1Right  = rect(22, 6,  6, 16);
        const bed1Bottom = rect(28, 6, 16, 16);

        // legs
        const legTop    = rect(53, 0, 3, 3);
        const legBottom = rect(56, 0, 3, 3);

        const legOutside   = rect(53, 3, 3, 3);
        const legInside  = rect(56, 3, 3, 3);

        const bed1 = makeBox([0, 3, 0],   [16, 9, 16], mat);    // head/pillow half at origin block

        const g1 = bed1.geometry;

        // block 1 (head)
        remapFace(g1, FACE.TOP,    bed1Top,    false, false);
        remapFaceRot90(g1, FACE.LEFT,  bed1Left,  3);
        remapFaceRot90(g1, FACE.RIGHT, bed1Right, 1);
        remapFace(g1, FACE.BACK,  bed1Back,   true,  true);
        remapFace(g1, FACE.FRONT,   bed1Front,   true,  false);     // south-facing visible end
        remapFace(g1, FACE.BOTTOM, bed1Bottom, false, false);

        // block 1 (left1/right1)
        const leg1L = makeBox([0, 0, 13],  [3, 3, 16], mat);
        const leg1R = makeBox([13, 0, 13], [16, 3, 16], mat);

        remapFace(leg1L.geometry, FACE.TOP, legTop, false, true);
        remapFace(leg1L.geometry, FACE.BOTTOM, legBottom, false, true);

        remapFace(leg1L.geometry, FACE.LEFT, legOutside, true, true);
        remapFace(leg1L.geometry, FACE.RIGHT, legInside, false, true);
        remapFace(leg1L.geometry, FACE.FRONT, legOutside, false, true);
        remapFace(leg1L.geometry, FACE.BACK, legInside, true, true);


        remapFace(leg1R.geometry, FACE.TOP, legTop, false, true);
        remapFace(leg1R.geometry, FACE.BOTTOM, legBottom, false, true);

        remapFace(leg1R.geometry, FACE.LEFT, legInside, true, true);
        remapFace(leg1R.geometry, FACE.RIGHT, legOutside, false, true);
        remapFace(leg1R.geometry, FACE.FRONT, legOutside, true, true);
        remapFace(leg1R.geometry, FACE.BACK, legInside, false, true);

        group.add(bed1, leg1L, leg1R);
    }

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeBannerMesh(bannerTex, id, bannerColor = "white") {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 64;
    const TEX_H = 64;

    const BANNER_COLORS = {
        "black": "#191919",
        "gray": "#4C4C4C",
        "light_gray": "#999999",
        "white": "#FFFFFF",
        "pink": "#F27FA5",
        "magenta": "#B24CD8",
        "purple": "#7F3FB2",
        "blue": "#334CB2",
        "cyan": "#4C7F99",
        "light_blue": "#6699D8",
        "green": "#667F33",
        "lime": "#7FCC19",
        "yellow": "#E5E533",
        "orange": "#D87F33",
        "brown": "#664C33",
        "red": "#993333",
    };

    const chosenHex = BANNER_COLORS[String(bannerColor).toLowerCase()] ?? "#FFFFFF";

    // Inclusive pixel coordinates:
    // (x0,y0) -> (x1,y1)
    const rectInc = (x0, y0, x1, y1) => ({
        u0: x0 / TEX_W,
        v0: y0 / TEX_H,
        u1: (x1 + 1) / TEX_W,
        v1: (y1 + 1) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        return new THREE.Mesh(geom, material);
    }

    // Cloth gets tinted
    const clothMat = new THREE.MeshBasicMaterial({
        map: bannerTex,
        color: new THREE.Color(chosenHex),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    clothMat.toneMapped = false;

    // Posts stay untinted
    const postMat = new THREE.MeshBasicMaterial({
        map: bannerTex,
        color: new THREE.Color("#FFFFFF"),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    postMat.toneMapped = false;

    //
    // TEXTURE RECTS
    //

    // Cloth
    const bannerFront  = rectInc(1, 1, 20, 40);
    const bannerLeft   = rectInc(0, 1, 0, 40);
    const bannerRight  = rectInc(21, 1, 21, 40);
    const bannerTop    = rectInc(1, 0, 20, 0);
    const bannerBottom = rectInc(21, 0, 40, 0);
    const bannerBack   = rectInc(22, 1, 40, 40);

    // Vertical post
    const vertBack   = rectInc(50, 2, 51, 43);
    const vertFront  = rectInc(46, 2, 47, 43);
    const vertLeft   = rectInc(44, 2, 45, 43);
    const vertRight  = rectInc(48, 2, 49, 43);
    const vertTop    = rectInc(46, 0, 47, 1);
    const vertBottom = rectInc(47, 0, 48, 1);

    // Horizontal post
    const horizBack   = rectInc(24, 44, 43, 45);
    const horizFront  = rectInc(2, 44, 21, 45);
    const horizLeft   = rectInc(0, 44, 1, 45);
    const horizRight  = rectInc(22, 44, 23, 45);
    const horizTop    = rectInc(2, 42, 21, 43);
    const horizBottom = rectInc(22, 42, 41, 43);

    //
    // GEOMETRY
    //

    const cloth = makeBox(
        [0, 4.5, 10],
        [19, 41, 11],
        clothMat
    );

    const vertPost = makeBox(
        [8.5, 0, 8],
        [10.5, 39, 10],
        postMat
    );

    const horizPost = makeBox(
        [0, 39, 8],
        [19, 41, 10],
        postMat
    );

    const cg = cloth.geometry;
    const vg = vertPost.geometry;
    const hg = horizPost.geometry;

    //
    // UV MAPPING
    //

    // Cloth
    remapFace(cg, FACE.FRONT,  bannerFront,  true, true);
    remapFace(cg, FACE.BACK,   bannerBack,   true, true);
    remapFace(cg, FACE.LEFT,   bannerLeft,   true, true);
    remapFace(cg, FACE.RIGHT,  bannerRight,  true, true);
    remapFace(cg, FACE.TOP,    bannerTop,    false, true);
    remapFace(cg, FACE.BOTTOM, bannerBottom, false, false);

    // Vertical post
    remapFace(vg, FACE.FRONT,  vertFront,  false, true);
    remapFace(vg, FACE.BACK,   vertBack,   false, true);
    remapFace(vg, FACE.LEFT,   vertLeft,   false, true);
    remapFace(vg, FACE.RIGHT,  vertRight,  false, true);
    remapFace(vg, FACE.TOP,    vertTop,    false, true);
    remapFace(vg, FACE.BOTTOM, vertBottom, false, false);

    // Horizontal post
    remapFace(hg, FACE.FRONT,  horizFront,  true, true);
    remapFace(hg, FACE.BACK,   horizBack,   false, true);
    remapFace(hg, FACE.LEFT,   horizLeft,   true, false);
    remapFace(hg, FACE.RIGHT,  horizRight,  true, false);
    remapFace(hg, FACE.TOP,    horizTop,    false, true);
    remapFace(hg, FACE.BOTTOM, horizBottom, false, false);

    inner.add(cloth, vertPost, horizPost);

    inner.scale.setScalar(0.75);
    inner.scale.multiply(new THREE.Vector3(0.925, 1, 0.925));

    inner.position.set(0.06, -0.125, 0.04);

    inner.rotation.y = Math.PI;

    group.add(inner);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeWallBannerMesh(bannerTex, id, bannerColor = "white", props = {}) {
    const facing = props?.facing;

    const group = new THREE.Group();
    const inner = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 64;
    const TEX_H = 64;

    const BANNER_COLORS = {
        "black": "#191919",
        "gray": "#4C4C4C",
        "light_gray": "#999999",
        "white": "#FFFFFF",
        "pink": "#F27FA5",
        "magenta": "#B24CD8",
        "purple": "#7F3FB2",
        "blue": "#334CB2",
        "cyan": "#4C7F99",
        "light_blue": "#6699D8",
        "green": "#667F33",
        "lime": "#7FCC19",
        "yellow": "#E5E533",
        "orange": "#D87F33",
        "brown": "#664C33",
        "red": "#993333",
    };

    const chosenHex = BANNER_COLORS[String(bannerColor).toLowerCase()] ?? "#FFFFFF";

    const rectInc = (x0, y0, x1, y1) => ({
        u0: x0 / TEX_W,
        v0: y0 / TEX_H,
        u1: (x1 + 1) / TEX_W,
        v1: (y1 + 1) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        return new THREE.Mesh(geom, material);
    }

    const clothMat = new THREE.MeshBasicMaterial({
        map: bannerTex,
        color: new THREE.Color(chosenHex),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    clothMat.toneMapped = false;

    const postMat = new THREE.MeshBasicMaterial({
        map: bannerTex,
        color: new THREE.Color("#FFFFFF"),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    postMat.toneMapped = false;

    // Cloth UVs
    const bannerFront  = rectInc(1, 1, 20, 40);
    const bannerLeft   = rectInc(0, 1, 0, 40);
    const bannerRight  = rectInc(21, 1, 21, 40);
    const bannerTop    = rectInc(1, 0, 20, 0);
    const bannerBottom = rectInc(21, 0, 40, 0);
    const bannerBack   = rectInc(22, 1, 40, 40);

    // Horizontal post UVs
    const horizBack   = rectInc(24, 44, 43, 45);
    const horizFront  = rectInc(2, 44, 21, 45);
    const horizLeft   = rectInc(0, 44, 1, 45);
    const horizRight  = rectInc(22, 44, 23, 45);
    const horizTop    = rectInc(2, 42, 21, 43);
    const horizBottom = rectInc(22, 42, 41, 43);

    // Against south wall: z 15..16-ish.
    // Cloth only, no vertical post.
    const cloth = makeBox(
        [0, -14, 0],
        [19, 22.5, 1],
        clothMat
    );

    // Keep the horizontal rod, also pushed against south wall.
    const horizPost = makeBox(
        [0, 20.5, -2],
        [19, 22.5, 0],
        postMat
    );

    const cg = cloth.geometry;
    const hg = horizPost.geometry;

    // Cloth
    remapFace(cg, FACE.FRONT,  bannerFront,  true, true);
    remapFace(cg, FACE.BACK,   bannerBack,   true, true);
    remapFace(cg, FACE.LEFT,   bannerLeft,   true, true);
    remapFace(cg, FACE.RIGHT,  bannerRight,  true, true);
    remapFace(cg, FACE.TOP,    bannerTop,    false, true);
    remapFace(cg, FACE.BOTTOM, bannerBottom, false, false);

    // Horizontal post
    remapFace(hg, FACE.FRONT,  horizFront,  true, true);
    remapFace(hg, FACE.BACK,   horizBack,   false, true);
    remapFace(hg, FACE.LEFT,   horizLeft,   true, false);
    remapFace(hg, FACE.RIGHT,  horizRight,  true, false);
    remapFace(hg, FACE.TOP,    horizTop,    false, true);
    remapFace(hg, FACE.BOTTOM, horizBottom, false, false);

    inner.add(cloth, horizPost);

    inner.rotation.y = Math.PI;

    if(facing === "west") {
        inner.rotation.y = Math.PI / 2;
        inner.position.set(-0.06, -0.31, 0.065);
    }
    else if(facing === "east"){
        inner.rotation.y = -Math.PI / 2;
        inner.position.set(0.06, -0.31, -0.065);
    }
    else if(facing === "south") {
        inner.rotation.y = 0;
        inner.position.set(-0.065, -0.31, -0.06);
    }
    else{
        inner.position.set(0.065, -0.31, 0.05);
    }

    // Same sizing/rotation convention as makeBannerMesh
    inner.scale.setScalar(0.75);
    inner.scale.multiply(new THREE.Vector3(0.925, 1, 0.925));


    group.add(inner);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeSkullMesh(headTex, id, { mirrorSides = false } = {}) {
    const toBlock = (x) => x / 16 - 0.5;

    const from = [4, 0, 4];
    const to   = [12, 8, 12];

    const wG = to[0] - from[0]; // 8
    const hG = to[1] - from[1]; // 8
    const dG = to[2] - from[2]; // 8

    const sx = wG / 16;
    const sy = hG / 16;
    const sz = dG / 16;

    const cx = toBlock((from[0] + to[0]) * 0.5);
    const cy = toBlock((from[1] + to[1]) * 0.5);
    const cz = toBlock((from[2] + to[2]) * 0.5);

    const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();

    // Head is at texOffs(0,0) in these entity textures.
    if(id.includes("piglin_head")) {
        return makePiglinHeadMesh(headTex);
    }
    else if(id.includes("dragon_head")) {
        return makeDragonHeadMesh(headTex);
    }
    else if(id.includes("zombie_head") || id.includes("player_head")) {
        applyModelRendererCubeUVs(geom, 0, 0, 8, 8, 8, 64, 64, mirrorSides);
    }
    else{
        applyModelRendererCubeUVs(geom, 0, 0, 8, 8, 8, 64, 32, mirrorSides);
    }

    const mat = new THREE.MeshBasicMaterial({
        map: headTex,
        transparent: true,    // safe for any transparent pixels (most heads aren't, but fine)
        alphaTest: 0.0,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
    });
    mat.toneMapped = false;

    // bake the “sit on floor” offset into vertices instead of mesh.position
    geom.translate(cx, cy, cz);
    geom.rotateY(Math.PI);

    const mesh = new THREE.Mesh(geom, mat);

// IMPORTANT: keep transform identity so placement/world-matrix logic can own it
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);

    return mesh;
}

function makePiglinHeadMesh(headTex) {
    const group = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    function makeBox(from, to, texU, texV, w, h, d, opts = {}) {

        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();

        applyModelRendererCubeUVs(geom, texU, texV, w, h, d, 64, 64);

        if(opts.rotZ) geom.rotateZ(opts.rotZ);

        const mat = new THREE.MeshBasicMaterial({
            map: headTex,
            transparent: true,
            side: THREE.DoubleSide
        });
        mat.toneMapped = false;

        geom.translate(cx, cy, cz);
        geom.rotateY(Math.PI);

        return new THREE.Mesh(geom, mat);
    }

    const deg = THREE.MathUtils.degToRad;

    // main skull
    group.add(
        makeBox([3,0,4],[13,8,12],0,0,10,8,8)
    );

    // snout
    group.add(
        makeBox([6,0,12],[10,4,13],31,1,4,4,1)
    );

    // left ear
    group.add(
        makeBox([1,2,6],[2,7,10],39,6,1,5,4, {rotZ: deg(-45)})
    );

    // right ear
    group.add(
        makeBox([14,2,6],[15,7,10],51,6,1,5,4, {rotZ: deg(45)})
    );

    // left horn
    group.add(
        makeBox([5,0,12],[6,2,13],2,0,1,2,1)
    );

    // right horn
    group.add(
        makeBox([10,0,12],[11,2,13],2,4,1,2,1)
    );

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeDragonHeadMesh(headTex) {
    const group = new THREE.Group();
    const offset = new THREE.Group();
    const inner = new THREE.Group();

    // Intrinsic model scale
    inner.scale.setScalar(0.735);

    offset.position.set(0, -0.135, 0.105);

    const toBlock = (x) => x / 16 - 0.5;

    function makeBox(from, to, texU, texV, w, h, d, opts = {}) {

        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();

        applyModelRendererCubeUVs(geom, texU, texV, w, h, d, 256, 256);

        if(opts.rotX) geom.rotateX(opts.rotX);

        if(opts.rotY) geom.rotateY(opts.rotY);

        const mat = new THREE.MeshBasicMaterial({
            map: headTex,
            transparent: true,
            side: THREE.DoubleSide
        });
        mat.toneMapped = false;

        geom.translate(cx, cy, cz);
        geom.rotateY(Math.PI);

        return new THREE.Mesh(geom, mat);
    }

    const deg = THREE.MathUtils.degToRad;

    // skull
    inner.add(
        makeBox([0,0,0],[16,16,16],112,30,16,16,16)
    );

    // snout top
    inner.add(
        makeBox([2,4,16],[14,9,32],176,44,12,5,16)
    );

    // snout bottom
    inner.add(
        makeBox([2,-1.5,15.5],[14,2.5,31.5],176,65,12,4,16, {rotX: deg(10)})
    );

    // horn left
    inner.add(
        makeBox([3,16,4],[5,20,10],0,0,2,4,6)
    );

    // horn left
    inner.add(
        makeBox([11,16,4],[13,20,10],48,0,2,4,6)
    );

    // nostril right
    inner.add(
        makeBox([11,9,26],[13,11,30],112,0,2,2,4)
    );

    // nostril left
    inner.add(
        makeBox([3,9,26],[5,11,30],112,0,2,2,4, {rotY: deg(180)})
    );

    offset.add(inner);
    group.add(offset);
    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeShulkerMesh(shulkerTex, id) {
    const group = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 64;
    const TEX_H = 64;

    const rectInc = (x0, y0, x1, y1) => ({
        u0: x0 / TEX_W,
        v0: y0 / TEX_H,
        u1: (x1 + 1) / TEX_W,
        v1: (y1 + 1) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        return new THREE.Mesh(geom, material);
    }

    // Texture regions you provided
    const topFace      = rectInc(16, 0, 31, 15);
    const bottomFace   = rectInc(32, 28, 47, 43);
    const topHalfSide  = rectInc(0, 16, 15, 27);
    const botHalfSide  = rectInc(0, 44, 15, 51);

    const mat = new THREE.MeshBasicMaterial({
        map: shulkerTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    mat.toneMapped = false;

    // Closed shulker made from two overlapping halves.
    // Total assembled height = 16.
    // Overlap = 4.
    // So:
    // bottom half: y 0..10
    // top half:    y 6..16
    const bottomShell = makeBox(
        [0, 0, 0],
        [16, 8, 16],
        mat
    );

    const topShell = makeBox(
        [0, 4, 0],
        [16, 16, 16],
        mat
    );

    const bg = bottomShell.geometry;
    const tg = topShell.geometry;

    // Bottom shell:
    // - use bottom strip on all side faces
    // - use bottom texture on DOWN
    // - leave UP unused
    remapFace(bg, FACE.FRONT,  botHalfSide, false, true);
    remapFace(bg, FACE.BACK,   botHalfSide, false, true);
    remapFace(bg, FACE.LEFT,   botHalfSide, false, true);
    remapFace(bg, FACE.RIGHT,  botHalfSide, false, true);
    remapFace(bg, FACE.BOTTOM, bottomFace,  false, false);

    // Top shell:
    // - use top strip on all side faces
    // - use top texture on UP
    // - leave DOWN unused
    remapFace(tg, FACE.FRONT,  topHalfSide, false, true);
    remapFace(tg, FACE.BACK,   topHalfSide, false, true);
    remapFace(tg, FACE.LEFT,   topHalfSide, false, true);
    remapFace(tg, FACE.RIGHT,  topHalfSide, false, true);
    remapFace(tg, FACE.TOP,    topFace,     false, true);

    // Remove hidden/interior faces
    const bottomNoTop = stripBoxFaces(bg, [FACE.TOP]);
    const topNoBottom = stripBoxFaces(tg, [FACE.BOTTOM]);

    bottomShell.geometry.dispose();
    topShell.geometry.dispose();

    bottomShell.geometry = bottomNoTop;
    topShell.geometry = topNoBottom;

    group.add(bottomShell, topShell);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeCopperGolemMesh(tex, id) {
    const group = new THREE.Group();
    const inner = new THREE.Group();

    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 64;
    const TEX_H = 64;

    const rectInc = (x0, y0, x1, y1) => ({
        u0: x0 / TEX_W,
        v0: y0 / TEX_H,
        u1: (x1 + 1) / TEX_W,
        v1: (y1 + 1) / TEX_H,
    });

    const remap = (g, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(g, face, u0, v0, u1, v1);
    };

    function makeBox(from, to) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        g.translate(cx, cy, cz);

        const m = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            side: THREE.DoubleSide
        });
        m.toneMapped = false;

        return new THREE.Mesh(g, m);
    }

    //
    // === TEXTURE RECTS ===
    //

    // Antenna tip
    const tipTop = rectInc(41,0,44,3);
    const tipBot = rectInc(45,0,48,3);
    const tipSide = rectInc(41,4,44,7);

    // Antenna pole
    const poleTop = rectInc(39,8,40,9);
    const poleBot = rectInc(41,8,42,9);
    const poleNS  = rectInc(39,10,40,13);
    const poleEW  = rectInc(41,10,42,13);

    // Head
    const headTop = rectInc(10,0,17,9);
    const headBot = rectInc(18,0,25,9);
    const headS = rectInc(10,10,17,14);
    const headN = rectInc(28,10,35,14);
    const headW = rectInc(0,10,9,14);
    const headE = rectInc(18,10,27,14);

    // Nose
    const noseTop = rectInc(58,0,59,1);
    const noseBot = rectInc(60,0,61,1);
    const noseSide = rectInc(58,2,59,4);

    // Body
    const bodyTB = rectInc(6,15,13,20);
    const bodyNS = rectInc(6,21,13,26);
    const bodyEW = rectInc(0,21,5,26);

    // Left arm
    const laTop = rectInc(40,16,42,19);
    const laBot = rectInc(43,16,45,19);
    const laN = rectInc(61,20,63,29);
    const laS = rectInc(54,20,56,29);
    const laE = rectInc(36,20,39,29);
    const laW = rectInc(43,20,46,29);

    // Right arm
    const raTop = rectInc(40,16,42,19);
    const raBot = rectInc(57,16,59,19);
    const raS = rectInc(40,20,42,29);
    const raN = rectInc(47,20,49,29);
    const raW = rectInc(36,20,39,29);
    const raE = rectInc(43,20,46,29);

    // Left leg
    const llTop = rectInc(4,27,7,30);
    const llBot = rectInc(8,27,11,30);
    const llS = rectInc(4,31,7,35);
    const llN = rectInc(12,31,15,35);
    const llW = rectInc(0,31,3,35);
    const llE = rectInc(8,31,11,35);

    // Right leg
    const rlTop = rectInc(4,27,7,30);
    const rlBot = rectInc(8,27,11,30);
    const rlS = rectInc(4,31,7,35);
    const rlN = rectInc(12,31,15,35);
    const rlW = rectInc(0,31,3,35);
    const rlE = rectInc(8,31,11,35);

    //
    // === GEOMETRY ===
    // (rough proportions — tweak later if needed)
    //

    const body = makeBox([4,5,5],[12,11,11]);
    const head = makeBox([4,11,3],[12,16,13]);
    const nose = makeBox([7,10,12],[9,13,14]);

    const leftArm  = makeBox([12,2,6],[15,12,10]);
    const rightArm = makeBox([1,2,6],[4,12,10]);

    const leftLeg  = makeBox([4,0,6],[8,5,10]);
    const rightLeg = makeBox([8,0,6],[12,5,10]);

    const pole = makeBox([7,16,7],[9,20,9]);
    const tip  = makeBox([6,20,6],[10,24,10]);

    //
    // === UV MAPPING ===
    //

    const mapCube = (mesh, maps) => {
        const g = mesh.geometry;
        remap(g, FACE.TOP, maps.top, false, true);
        remap(g, FACE.BOTTOM, maps.bottom, false, false);
        remap(g, FACE.FRONT, maps.south, false, true);
        remap(g, FACE.BACK, maps.north, false, true);
        remap(g, FACE.LEFT, maps.west, false, true);
        remap(g, FACE.RIGHT, maps.east, false, true);
    };

    mapCube(head, {top:headTop,bottom:headBot,south:headS,north:headN,west:headW,east:headE});
    mapCube(body, {top:bodyTB,bottom:bodyTB,south:bodyNS,north:bodyNS,west:bodyEW,east:bodyEW});

    // Left arm
    const lag = leftArm.geometry;
    remap(lag, FACE.TOP, laTop, true, true);
    remap(lag, FACE.BOTTOM, laBot, true, true);
    remap(lag, FACE.FRONT, laS, false, true);
    remap(lag, FACE.BACK, laN, false, true);
    remap(lag, FACE.LEFT, laW, false, true);
    remap(lag, FACE.RIGHT, laE, true, true);

    // Right arm
    const rag = rightArm.geometry
    remap(rag, FACE.TOP, raTop, false, true);
    remap(rag, FACE.BOTTOM, raBot, true, true);
    remap(rag, FACE.FRONT, raS, false, true);
    remap(rag, FACE.BACK, raN, false, true);
    remap(rag, FACE.LEFT, raW, false, true);
    remap(rag, FACE.RIGHT, raE, false, true);

    // Left leg
    const lg = leftLeg.geometry;
    remap(lg, FACE.TOP, llTop, false, true);
    remap(lg, FACE.BOTTOM, llBot, false, false);
    remap(lg, FACE.FRONT, llS, false, true);
    remap(lg, FACE.BACK, llN, false, true, );   // mirror
    remap(lg, FACE.LEFT, llW, false, true);   // mirror
    remap(lg, FACE.RIGHT, llE, false, true);

    // Right leg with mirroring
    const rg = rightLeg.geometry;
    remap(rg, FACE.TOP, rlTop, false, true);
    remap(rg, FACE.BOTTOM, rlBot, false, false);
    remap(rg, FACE.FRONT, rlS, false, true);
    remap(rg, FACE.BACK, rlN, true, true, );   // mirror
    remap(rg, FACE.LEFT, rlW, true, true);   // mirror
    remap(rg, FACE.RIGHT, rlE, true, true);

    // Nose
    mapCube(nose,{top:noseTop,bottom:noseBot,south:noseSide,north:noseSide,west:noseSide,east:noseSide});

    // Pole
    mapCube(pole,{top:poleTop,bottom:poleBot,south:poleNS,north:poleNS,west:poleEW,east:poleEW});

    // Tip
    mapCube(tip,{top:tipTop,bottom:tipBot,south:tipSide,north:tipSide,west:tipSide,east:tipSide});

    //
    // === GROUP + FINAL ROTATION ===
    //

    inner.add(body, head, nose, leftArm, rightArm, leftLeg, rightLeg, pole, tip);

    inner.rotation.y = Math.PI;

    inner.updateMatrix();
    inner.matrixAutoUpdate = false;

    group.add(inner);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeConduitMesh(conduitTex, id) {
    const group = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 32;
    const TEX_H = 16;

    const rectInc = (x0, y0, x1, y1) => ({
        u0: x0 / TEX_W,
        v0: y0 / TEX_H,
        u1: (x1 + 1) / TEX_W,
        v1: (y1 + 1) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        return new THREE.Mesh(geom, material);
    }

    const topRect = rectInc(12, 0, 17, 5);
    const botRect = rectInc(6, 0, 11, 5);
    const northRect = rectInc(6, 6, 11, 11);
    const southRect = rectInc(18, 6, 23, 11);
    const eastRect = rectInc(12, 6, 17, 11);
    const westRect = rectInc(0, 6, 5, 11);

    const mat = new THREE.MeshBasicMaterial({
        map: conduitTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    mat.toneMapped = false;

    // centered 6x6x6 cube
    const conduit = makeBox(
        [5, 5, 5],
        [11, 11, 11],
        mat
    );

    const g = conduit.geometry;

    remapFace(g, FACE.TOP,    topRect,   false, false);
    remapFace(g, FACE.BOTTOM, botRect,   false, true);
    remapFace(g, FACE.FRONT,  southRect, true,  false);
    remapFace(g, FACE.BACK,   northRect, true,  false);
    remapFace(g, FACE.LEFT,   westRect,  true,  false);
    remapFace(g, FACE.RIGHT,  eastRect,  true,  false);

    group.add(conduit);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeDecoratedPotMesh(sideTex, baseTex, id) {
    const group = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const SIDE_W = 16;
    const SIDE_H = 16;

    const BASE_W = 32;
    const BASE_H = 32;

    const rectInc = (x0, y0, x1, y1, texW, texH) => ({
        u0: x0 / texW,
        v0: y0 / texH,
        u1: (x1 + 1) / texW,
        v1: (y1 + 1) / texH,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();

        const mesh = new THREE.Mesh(geom, material);
        mesh.position.set(cx, cy, cz);
        return mesh;
    }

    const sideMat = new THREE.MeshBasicMaterial({
        map: sideTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    sideMat.toneMapped = false;

    const baseMat = new THREE.MeshBasicMaterial({
        map: baseTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    baseMat.toneMapped = false;

    // UV rects
    const potSide   = rectInc(1, 0, 14, 15, SIDE_W, SIDE_H);
    const potTopBot = rectInc(0, 13, 13, 26, BASE_W, BASE_H);

    const neckSide  = rectInc(0, 11, 5, 11, BASE_W, BASE_H);

    const openSouth = rectInc(8, 8, 15, 10, BASE_W, BASE_H);
    const openWest  = rectInc(0, 8, 7, 10, BASE_W, BASE_H);
    const openEast  = rectInc(16, 8, 23, 10, BASE_W, BASE_H);
    const openNorth = rectInc(24, 8, 31, 10, BASE_W, BASE_H);
    const openTop   = rectInc(8, 0, 15, 7, BASE_W, BASE_H);
    const openBot   = rectInc(16, 0, 23, 7, BASE_W, BASE_H);

    //
    // Geometry
    // base    = 14w x 16h x 14d
    // neck    = 6w  x 1h  x 6d
    // opening = 8w  x 3h  x 8d
    //

    const baseSides = makeBox(
        [1, 0, 1],
        [15, 16, 15],
        sideMat
    );

    const baseCaps = makeBox(
        [1, 0, 1],
        [15, 16, 15],
        baseMat
    );

    const neck = makeBox(
        [5, 16, 5],
        [11, 17, 11],
        baseMat
    );

    const opening = makeBox(
        [4, 17, 4],
        [12, 20, 12],
        baseMat
    );

    // Base side shell UVs
    const bsg = baseSides.geometry;
    remapFace(bsg, FACE.FRONT, potSide, false, true);
    remapFace(bsg, FACE.BACK,  potSide, false, true);
    remapFace(bsg, FACE.LEFT,  potSide, false, true);
    remapFace(bsg, FACE.RIGHT, potSide, false, true);

    // Base caps UVs
    const bcg = baseCaps.geometry;
    remapFace(bcg, FACE.TOP,    potTopBot, false, true);
    remapFace(bcg, FACE.BOTTOM, potTopBot, false, false);

    // Neck UVs
    const ng = neck.geometry;
    remapFace(ng, FACE.FRONT, neckSide, false, true);
    remapFace(ng, FACE.BACK,  neckSide, false, true);
    remapFace(ng, FACE.LEFT,  neckSide, false, true);
    remapFace(ng, FACE.RIGHT, neckSide, false, true);

    // Opening UVs
    const og = opening.geometry;
    remapFace(og, FACE.FRONT,  openSouth, false, true);
    remapFace(og, FACE.BACK,   openNorth, false, true);
    remapFace(og, FACE.LEFT,   openWest,  false, true);
    remapFace(og, FACE.RIGHT,  openEast,  false, true);
    remapFace(og, FACE.TOP,    openTop,   false, true);
    remapFace(og, FACE.BOTTOM, openBot,   false, false);

    // Strip faces AFTER remapping so FACE indices still match
    baseSides.geometry = stripBoxFaces(baseSides.geometry, [FACE.TOP, FACE.BOTTOM]);
    baseCaps.geometry  = stripBoxFaces(baseCaps.geometry, [FACE.FRONT, FACE.BACK, FACE.LEFT, FACE.RIGHT]);
    neck.geometry      = stripBoxFaces(neck.geometry, [FACE.TOP, FACE.BOTTOM]);

    group.add(baseSides, baseCaps, neck, opening);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeShelfMesh(shelfTex, id, { facing = "north", front = "center" } = {}) {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 32;
    const TEX_H = 32;

    const rect = (u0, v0, u1, v1) => ({
        u0: u0 / TEX_W,
        v0: v0 / TEX_H,
        u1: u1 / TEX_W,
        v1: v1 / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        const mesh = new THREE.Mesh(geom, material);
        mesh.position.set(cx, cy, cz);
        return mesh;
    }

    const mat = new THREE.MeshBasicMaterial({
        map: shelfTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    mat.toneMapped = false;

    //
    // UVs taken directly from the model JSON you posted
    //

    // body
    const bodyEast  = rect(16,   0,  19, 16);
    const bodySouth = rect(16,   0, 32,   16);
    const bodyWest  = rect(29,0, 32,   16);
    const bodyUp    = rect(32,  10,  16,   7);
    const bodyDown  = rect(32,  12,  16,   9);

    // bottom lip
    const bottomNorth = rect(0,   12, 16,   16);
    const bottomEast  = rect(3, 12, 5, 16);
    const bottomWest  = rect(11, 12, 13, 16);
    const bottomUp    = rect(16,   7, 32, 9);
    const bottomDown  = rect(32,  9, 16,  7);

    // top lip
    const topNorth = rect(0,   0, 16,   4);
    const topEast  = rect(3, 0, 5, 4);
    const topWest  = rect(11, 0, 13, 4);
    const topUp    = rect(32,  12, 16,   10);
    const topDown  = rect(16,   10, 32,  12);

    // front insert variants
    const frontRect = rect(0,4,16,12);
    //
    // Geometry
    //

    const body = makeBox(
        [0, 0, 13],
        [16, 16, 16],
        mat
    );

    const bottomLip = makeBox(
        [0, 0, 11],
        [16, 4, 13],
        mat
    );

    const topLip = makeBox(
        [0, 12, 11],
        [16, 16, 13],
        mat
    );

    // thin front insert, inset where the game model places it
    const frontInsert = makeBox(
        [0, 4, 12.90],
        [16, 12, 13.00],
        mat
    );

    //
    // UV remap first, strip after
    //

    // body
    const bg = body.geometry;
    remapFace(bg, FACE.RIGHT,  bodyEast,  false, true);
    remapFace(bg, FACE.FRONT,  bodySouth, false, true);
    remapFace(bg, FACE.LEFT,   bodyWest,  false, true);
    remapFace(bg, FACE.TOP,    bodyUp,    false, false);
    remapFace(bg, FACE.BOTTOM, bodyDown,  false, false);

    // bottom lip
    const blg = bottomLip.geometry;
    remapFace(blg, FACE.BACK,   bottomNorth, false, true);
    remapFace(blg, FACE.RIGHT,  bottomEast,  false, true);
    remapFace(blg, FACE.LEFT,   bottomWest,  false, true);
    remapFace(blg, FACE.TOP,    bottomUp,    false, false);
    remapFace(blg, FACE.BOTTOM, bottomDown,  false, false);

    // top lip
    const tlg = topLip.geometry;
    remapFace(tlg, FACE.BACK,   topNorth, false, true);
    remapFace(tlg, FACE.RIGHT,  topEast,  false, true);
    remapFace(tlg, FACE.LEFT,   topWest,  false, true);
    remapFace(tlg, FACE.TOP,    topUp,    false, false);
    remapFace(tlg, FACE.BOTTOM, topDown,  false, false);

    // front insert
    const fig = frontInsert.geometry;
    remapFace(fig, FACE.BACK, frontRect, false, true);

    // strip unused faces AFTER remap
    body.geometry       = stripBoxFaces(body.geometry,       [FACE.BACK]);
    bottomLip.geometry  = stripBoxFaces(bottomLip.geometry,  [FACE.FRONT]);
    topLip.geometry     = stripBoxFaces(topLip.geometry,     [FACE.FRONT]);
    frontInsert.geometry = stripBoxFaces(frontInsert.geometry, [FACE.RIGHT, FACE.LEFT, FACE.TOP, FACE.BOTTOM, FACE.FRONT]);

    inner.add(body, bottomLip, topLip, frontInsert);

    // rotate by facing
    const yRot = {
        north: 0,
        east: -Math.PI / 2,
        south: Math.PI,
        west: Math.PI / 2,
    }[facing] ?? 0;

    inner.rotation.y = yRot;
    inner.updateMatrix();
    inner.matrixAutoUpdate = false;

    group.add(inner);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeBellMesh(bellTex, id) {
    const group = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 32;
    const TEX_H = 32;

    const rectInc = (x0, y0, x1, y1) => ({
        u0: x0 / TEX_W,
        v0: y0 / TEX_H,
        u1: (x1 + 1) / TEX_W,
        v1: (y1 + 1) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        const mesh = new THREE.Mesh(geom, material);
        mesh.position.set(cx, cy, cz);
        return mesh;
    }

    const mat = new THREE.MeshBasicMaterial({
        map: bellTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        alphaTest: 0.01,
    });
    mat.toneMapped = false;

    //
    // UV rects
    //

    // bell body
    const bodyTop = rectInc(6, 0, 11, 5);
    const bodyBot = rectInc(12, 0, 17, 6);
    const bodyN   = rectInc(18, 6, 23, 12);
    const bodyS   = rectInc(6, 6, 11, 12);
    const bodyE   = rectInc(12, 6, 17, 12);
    const bodyW   = rectInc(0, 6, 5, 12);

    // bell tip
    const tipTop = rectInc(8, 13, 15, 20);
    const tipBot = rectInc(16, 13, 23, 20);
    const tipN   = rectInc(16, 21, 23, 22);
    const tipS   = rectInc(8, 21, 15, 22);
    const tipE   = rectInc(24, 21, 31, 22);
    const tipW   = rectInc(0, 21, 7, 22);


    const body = makeBox(
        [5, 6, 5],
        [11, 13, 11],
        mat
    );

    const tip = makeBox(
        [4, 6, 4],
        [12, 4, 12],
        mat
    );

    //
    // UV mapping
    //

    const bg = body.geometry;
    remapFace(bg, FACE.TOP,    bodyTop, true, true);
    remapFace(bg, FACE.BOTTOM, bodyBot, false, false);
    remapFace(bg, FACE.BACK,   bodyN,   true, false);
    remapFace(bg, FACE.FRONT,  bodyS,   true, false);
    remapFace(bg, FACE.RIGHT,  bodyE,   true, false);
    remapFace(bg, FACE.LEFT,   bodyW,   true, false);

    const tg = tip.geometry;
    remapFace(tg, FACE.TOP,    tipTop, false, true);
    remapFace(tg, FACE.BOTTOM, tipBot, true, false);
    remapFace(tg, FACE.BACK,   tipN,   true, true);
    remapFace(tg, FACE.FRONT,  tipS,   true, true);
    remapFace(tg, FACE.RIGHT,  tipE,   true, true);
    remapFace(tg, FACE.LEFT,   tipW,   true, true);

    group.add(body, tip);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeEndGatewayMesh(gatewayTex, id) {
    const group = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 256;
    const TEX_H = 256;

    const rect = (x, y, w, h) => ({
        u0: x / TEX_W,
        v0: y / TEX_H,
        u1: (x + w) / TEX_W,
        v1: (y + h) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        return new THREE.Mesh(geom, material);
    }

    const mat = makeEndPortalShaderMaterial(gatewayTex, {
        layers: [
            { tint: new THREE.Color(0x16333d), speedX:  0.002, speedY:  0.003, scale: 125.0, alpha: 0.95 },
            { tint: new THREE.Color(0x1d4f58), speedX: -0.003, speedY:  0.004, scale: 145.0, alpha: 0.65 },
            { tint: new THREE.Color(0x216d6c), speedX:  0.0085, speedY: -0.0025, scale: 185.0, alpha: 0.48 },
            { tint: new THREE.Color(0x2a8980), speedX: -0.006, speedY: -0.005, scale: 230.0, alpha: 0.36 },
            { tint: new THREE.Color(0x6ca37e), speedX:  0.004, speedY:  0.007, scale: 285.0, alpha: 0.24 },

            // gateway-only blue layer
            { tint: new THREE.Color(0x2f7fd8), speedX:  0.01, speedY:  0.010, scale: 115.0, alpha: 0.38 },
            { tint: new THREE.Color(0x4f96ff), speedX:  0.0075, speedY:  0.008, scale: 110.0, alpha: 0.22 },
        ],
        opacity: 1,
        contrast: 1.0,
        brightness: 2.05,
    });

    const cube = makeBox([0, 0, 0], [16, 16, 16], mat);
    group.add(cube);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}

function makeEndPortalMesh(portalTex, id) {
    const group = new THREE.Group();
    const toBlock = (x) => x / 16 - 0.5;

    const TEX_W = 256;
    const TEX_H = 256;

    const rect = (x, y, w, h) => ({
        u0: x / TEX_W,
        v0: y / TEX_H,
        u1: (x + w) / TEX_W,
        v1: (y + h) / TEX_H,
    });

    const remapFace = (geom, face, r, flipU = false, flipV = false) => {
        let { u0, v0, u1, v1 } = r;
        if (flipU) [u0, u1] = [u1, u0];
        if (flipV) [v0, v1] = [v1, v0];
        remapUVsToRect(geom, face, u0, v0, u1, v1);
    };

    function makeBox(from, to, material) {
        const sx = (to[0] - from[0]) / 16;
        const sy = (to[1] - from[1]) / 16;
        const sz = (to[2] - from[2]) / 16;

        const cx = toBlock((from[0] + to[0]) * 0.5);
        const cy = toBlock((from[1] + to[1]) * 0.5);
        const cz = toBlock((from[2] + to[2]) * 0.5);

        const geom = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        geom.translate(cx, cy, cz);

        return new THREE.Mesh(geom, material);
    }

    const mat = makeEndPortalShaderMaterial(portalTex, {
        layers: [
            { tint: new THREE.Color(0x16333d), speedX:  0.002, speedY:  0.003, scale: 115.0, alpha: 0.95 },
            { tint: new THREE.Color(0x1d4f58), speedX: -0.003, speedY:  0.004, scale: 145.0, alpha: 0.65 },
            { tint: new THREE.Color(0x216d6c), speedX:  0.00425, speedY: -0.0025, scale: 185.0, alpha: 0.48 },
            { tint: new THREE.Color(0x2a8980), speedX: -0.006, speedY: -0.005, scale: 230.0, alpha: 0.36 },
            { tint: new THREE.Color(0x6ca37e), speedX:  0.004, speedY:  0.007, scale: 285.0, alpha: 0.24 },
            { tint: new THREE.Color(0x52AB8C), speedX: -0.0075, speedY:  0.006, scale: 205.0, alpha: 0.18 },
        ],
        opacity: 1,
        contrast: 1.0,
        brightness: 1.9,
    });

    // height = ~12/16 = 0.75
    const portal = makeBox(
        [0, 5, 0],
        [16, 12, 16],
        mat
    );

    group.add(portal);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    attachCollidersFromChildMeshes(group, "special-child-meshes");
    return group;;
}


export {loadExternalTexture, makeSingleChestMesh, makeSignMesh, makeWallSignMesh, makeBedMesh, makeBannerMesh,
    makeWallBannerMesh, makeSkullMesh, makeShulkerMesh, makeCopperGolemMesh, makeConduitMesh, makeDecoratedPotMesh,
    makeShelfMesh, makeBellMesh, makeEndGatewayMesh, makeEndPortalMesh, makeHangingSignMesh, makeWallHangingSignMesh}