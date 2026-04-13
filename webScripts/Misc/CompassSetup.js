import * as THREE from "three";
import {state} from "./StateData.js";

function cameraYawDeg() {
    const dir = new THREE.Vector3();
    state.camera.getWorldDirection(dir);
    const yaw = Math.atan2(-dir.x, dir.z) * (180 / Math.PI);
    return (yaw + 360) % 360;
}

function yawToCompass(yaw) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const idx = Math.round(((yaw + 180) % 360) / 45) % 8;
    return dirs[idx];
}

function yawToDeg(yaw){
    if (yaw > 0 && yaw < 180) return yaw;
    else return (yaw - 360);
}

function modeToLabel(mode) {
    if (mode === "translate") return "Translate";
    if (mode === "rotate") return "Rotate";
    if (mode === "scale") return "Scale";
    return "Unknown";
}

export function updateFacingCompass() {
    const yaw = cameraYawDeg();
    const facing = yawToCompass(yaw);

    const needle = document.getElementById("compassNeedle");
    const facingLabel = document.getElementById("compassFacingLabel");
    const degreesEl = document.getElementById("compassDegrees");
    const modeEl = document.getElementById("modeReadout");

    if (needle) {
        // continuous 360° rotation
        needle.style.transform = `translate(-50%, -100%) rotate(${(yaw+180)}deg)`;
    }

    if (facingLabel) {
        facingLabel.textContent = `${facing}°`;
    }

    if (degreesEl) {
        degreesEl.textContent = `${Math.round(yawToDeg(yaw+180))}°`;
    }

    if (modeEl) {
        const mode = state.api.transform?.getMode?.() || "translate";
        modeEl.textContent = modeToLabel(mode);
    }
}