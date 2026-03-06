import * as THREE from 'three';

import { remapUVsToRect } from "./UVRectHelpers.js";



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

    group.add(base, lid, knob);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = "minecraft:chest";
        }
    });

    return group;
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

    return group;
}

function makeBedMesh(bedTex, id) {
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

    // head/pillow half (bed block 1)
    const bed1Top    = rect(6,  6, 16, 16);
    const bed1Left   = rect(0,  6,  6, 16);
    const bed1Front   = rect(6,  0, 16,  6);
    const bed1Back  = rect(5, 53, 16, 6);
    const bed1Right  = rect(22, 6,  6, 16);
    const bed1Bottom = rect(28, 6, 16, 16);

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


    const bed1 = makeBox([0, 3, 0],   [16, 9, 16], mat);    // head/pillow half at origin block
    const bed2 = makeBox([0, 3, -16], [16, 9, 0],  mat);    // foot half one block north

    const g1 = bed1.geometry;
    const g2 = bed2.geometry;


    // block 1 (head)
    remapFace(g1, FACE.TOP,    bed1Top,    false, false);
    remapFaceRot90(g1, FACE.LEFT,  bed1Left,  3);
    remapFaceRot90(g1, FACE.RIGHT, bed1Right, 1);
    remapFace(g1, FACE.BACK,  bed1Back,   true,  true);
    remapFace(g1, FACE.FRONT,   bed1Front,   true,  false);     // south-facing visible end
    remapFace(g1, FACE.BOTTOM, bed1Bottom, false, false);

    // block 2 (foot)
    remapFace(g2, FACE.TOP,    bed2Top,    false, false);
    remapFaceRot90(g2, FACE.LEFT,  bed2Left,  3);
    remapFaceRot90(g2, FACE.RIGHT, bed2Right, 1);
    remapFace(g2, FACE.FRONT,   bed2Front,  true,  true);
    remapFace(g2, FACE.BACK,  bed2Back,  true,  false);         // north-facing visible end
    remapFace(g2, FACE.BOTTOM, bed2Bottom, false, false);

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

    // block 2 (left2/right2)
    const leg2L = makeBox([0, 0, -16],  [3, 3, -13], mat);
    const leg2R = makeBox([13, 0, -16], [16, 3, -13], mat);

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

    group.add(bed1, bed2, leg1L, leg1R, leg2L, leg2R);

    group.traverse((o) => {
        if (o.isMesh) {
            o.userData.isPlaceable = true;
            o.userData.kind = "block";
            o.userData.blockId = id;
        }
    });

    return group;
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

    return group;
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
    return group;
}

export {loadExternalTexture, makeSingleChestMesh, makeSignMesh, makeBedMesh, makeSkullMesh}