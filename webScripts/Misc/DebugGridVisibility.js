// DebugVisibilitySetup.js

import { gridFine, gridCoarse } from "../3DEditorSetup/SceneFunctions.js";

export function initDebugVisibilityUI(state) {
    const btn = state.ui.toggleGridBtn;
    if (!btn) return;

    function applyFloorHelpersVisible(visible) {
        state.debug.floorHelpersVisible = visible;

        if (!visible) {
            gridFine.visible = false;
            gridCoarse.visible = false;
        } else {
            const coarseMode = state.debug.showCoarseGrid !== false;
            gridCoarse.visible = coarseMode;
            gridFine.visible = !coarseMode;
        }

        for (const lbl of state.debug.floorCompassLabels || []) {
            if (lbl) lbl.visible = visible;
        }

        if (state.debug.floorMarkerMesh) {
            state.debug.floorMarkerMesh.visible = visible;
        }

        btn.classList.toggle("active", !visible);
        btn.title = visible ? "Hide grid and floor helpers" : "Show grid and floor helpers";
    }

    btn.addEventListener("click", () => {
        applyFloorHelpersVisible(!state.debug.floorHelpersVisible);
    });

    state.api.setFloorHelpersVisible = applyFloorHelpersVisible;
    applyFloorHelpersVisible(true);
}