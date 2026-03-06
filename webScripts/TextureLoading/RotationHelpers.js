function rotateQuadUV(quad, rot) {
    // quad: 4 corners in order [v0,v1,v2,v3]
    // rotations are clockwise in Minecraft model format.
    const r = ((rot % 360) + 360) % 360;
    if (r === 0) return quad;

    // 90 CW: (u,v) -> (v, 1-u)
    // 180: -> (1-u, 1-v)
    // 270: -> (1-v, u)
    const mapOne = (u, v) => {
        if (r === 90) return [v, 1 - u];
        if (r === 180) return [1 - u, 1 - v];
        if (r === 270) return [1 - v, u];
        return [u, v];
    };

    return quad.map(([u, v]) => mapOne(u, v));
}

function rotatePoint(p, origin, axis, angleDeg) {
    const a = (angleDeg * Math.PI) / 180;
    const s = Math.sin(a), c = Math.cos(a);

    // translate to origin
    let x = p[0] - origin[0];
    let y = p[1] - origin[1];
    let z = p[2] - origin[2];

    if (axis === "x") {
        const y2 = y * c - z * s;
        const z2 = y * s + z * c;
        y = y2; z = z2;
    } else if (axis === "y") {
        const x2 = x * c + z * s;
        const z2 = -x * s + z * c;
        x = x2; z = z2;
    } else if (axis === "z") {
        const x2 = x * c - y * s;
        const y2 = x * s + y * c;
        x = x2; y = y2;
    }

    // translate back
    return [x + origin[0], y + origin[1], z + origin[2]];
}


function applyElementRotation(v, rot) {
    if (!rot) return v;

    // Minecraft rotation: origin is in 0..16 space
    const origin = rot.origin ?? [8, 8, 8];
    const axis = rot.axis;      // "x"|"y"|"z"
    const angle = rot.angle;    // usually 22.5 / 45 / 90
    const rescale = !!rot.rescale; // ignore for now

    return rotatePoint(v, origin, axis, angle);
}

export {applyElementRotation, rotateQuadUV}