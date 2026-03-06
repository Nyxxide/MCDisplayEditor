function rectToUVs(rect, atlasW, atlasH) {
    const u0 = rect.x / atlasW;
    const v0 = rect.y / atlasH;
    const u1 = (rect.x + rect.w) / atlasW;
    const v1 = (rect.y + rect.h) / atlasH;
    return { u0, v0, u1, v1 };
}

function remapUVsToRect(geom, faceIndex, u0, v0, u1, v1) {
    const uv = geom.attributes.uv;

    if (!geom.userData._baseUV) {
        geom.userData._baseUV = uv.array.slice();
    }
    const base = geom.userData._baseUV;

    const du = u1 - u0;
    const dv = v1 - v0;

    const faceBase = faceIndex * 6;

    for (let i = 0; i < 6; i++) {
        const vert = faceBase + i;
        const u = base[vert * 2 + 0];
        const v = base[vert * 2 + 1];
        uv.setXY(vert, u0 + u * du, v0 + v * dv);
    }

    uv.needsUpdate = true;
}

function remap(geom, face, r, mirrorU=false) {
    if (mirrorU) {
        remapUVsToRect(geom, face, r.u1, r.v0, r.u0, r.v1); // swap u0/u1
    } else {
        remapUVsToRect(geom, face, r.u0, r.v0, r.u1, r.v1);
    }
}

export { rectToUVs, remapUVsToRect, remap };