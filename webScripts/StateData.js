// StateData.js
// ------------
// Central shared state + DOM bindings

export const state = {
    // core three
    scene: null,
    gizmoScene: null,
    camera: null,
    renderer: null,
    composer: null,
    orbit: null,

    // post
    post: {
        outlinePass: null,
    },

    // selection / transform
    selectionRig: null,
    activeRig: null,
    selectionIsTempRig: false,
    selectionBase: null,

    // data
    entities: [], // { id, blockName, mesh }
    groups: [],   // { id, members: [entityId...] }
    groupNodes: new Map(), // groupId -> THREE.Group root

    // refs (non-exportable)
    refs: [], // { id, name, kind, assetId, root, url }
    refAssets: new Map(), // assetId -> { kind, name, bytesBase64 }
    selectedRefId: null,

    // selection sets
    selectedIds: new Set(),

    // interaction
    isDraggingMesh: false,
    isDraggingRef: false,
    isTransforming: false,
    shiftHeld: false,
    scaleDragStart: null,

    // box select ui state (SelectionLogic uses these)
    boxSelecting: false,
    boxStart: { x: 0, y: 0 },

    // history
    history: [],
    historyIndex: -1,

    // clipboard
    blockClipboard: null,
    refClipboard: null,
    groupClipboard: null,

    // constants
    const: {
        TRANS_SNAP: 0.25,
        ROT_SNAP_DEG: 5,
        HISTORY_MAX: 25,
    },

    // dom
    ui: {},

    // cross-module hooks (wired in main)
    api: {},

    // atlas
    atlas: null,
};

export function initDom() {
    // ----- Left UI -----
    state.ui.paletteEl = document.getElementById("palette");
    state.ui.outList = document.getElementById("outList");
    state.ui.facingEl = document.getElementById("facing");

    state.ui.importRefBtn = document.getElementById("importRefBtn");
    state.ui.importRefInput = document.getElementById("importRefInput");

    state.ui.placeBtn = document.getElementById("place");
    state.ui.exportManyBtn = document.getElementById("exportMany");
    state.ui.exportOneBtn = document.getElementById("exportOne");

    // ----- Transform UI -----
    state.ui.xformUI = document.getElementById("xformUI");
    state.ui.xformHintsEl = state.ui.xformUI ? state.ui.xformUI.querySelector(".xSmall") : null;

    state.ui.px = document.getElementById("px");
    state.ui.py = document.getElementById("py");
    state.ui.pz = document.getElementById("pz");
    state.ui.rx = document.getElementById("rx");
    state.ui.ry = document.getElementById("ry");
    state.ui.rz = document.getElementById("rz");
    state.ui.sx = document.getElementById("sx");
    state.ui.sy = document.getElementById("sy");
    state.ui.sz = document.getElementById("sz");

    state.ui.copyBtn = document.getElementById("copyBtn");
    state.ui.pasteBtn = document.getElementById("pasteBtn");

    // Hide xform panel initially
    if (state.ui.xformUI) state.ui.xformUI.style.display = "none";
}
