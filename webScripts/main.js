// TODO: Add selection to change dropdown/search between Blocks/Items/Atlases
// TODO: Maybe make audio a bit louder or something. kinda quiet.
// TODO: Scale (maybe exclusive to groups?) in the xform resets to 1. i think when mode switch or something idk double check it.

/* TODO Texture Stuff:
*   - Add Props to blocks as I find em.
*/

/*
*  TODO Housekeeping:
*   - Reogranize Resources to split into Blocks/Items/Atlases (move everything currently in there for blocks into Blocks folder)
*   - Maybe go through all the large webScript files again and see about cutting them down? Anything around 2k lines see if I can split
*/

/*
*  TODO Long Term Texture Additions:
*   - Item Displays
*   - Text Displays with every possible atlas texture
*/

/*
*  TODO Backend:
*   - Design a script to watch for the latest Minecraft update if a new one was released.
*     -- If there is a new update, call genBlockList and compare output to the old one (diff). If anything new, find file and add it to resources accordingly. If not, leave alone.
 */

import * as THREE from "three";
import { state, initDom } from "./Misc/StateData.js";
import { initScene } from "./3DEditorSetup/SceneFunctions.js";
import { initSelectionLogic } from "./3DEditorSetup/SelectionLogic.js";
import { initTransformLogic} from "./3DEditorSetup/TransformLogic.js";
import { initImportLogic } from "./FileHandling/FileImportLogic.js";
import { initSaveLoadLogic } from "./FileHandling/SaveLoadLogic.js"
import { loadBlockList } from "./TextureLoading/TextureLoad.js";
import { initPaletteUI } from "./TextureLoading/PaletteUI.js";
import { initAnimations } from "./TextureLoading/BlockAnimationLogic.js";
import { initImportCommandLogic } from "./Misc/ImportModelFromCommand.js";
import { initCommandOutputBtns, initInstructionsModal, initSidebarToggle } from "./Misc/UISetup.js";
import { initAudioTriggers } from "./Misc/AudioControl.js"
import { initDebugVisibilityUI } from "./Misc/DebugGridVisibility.js";
import { initModelLibraryModal } from "./Misc/ModelLibrarySetup.js";


// -------------------- Init --------------------
const clock = new THREE.Clock();

initDom();
await initScene(state);

// palette blocks
const BLOCKS = await loadBlockList();

// fill palette
await initPaletteUI(state, BLOCKS);

// selection + history + dragging
initSelectionLogic(state);

// transforms + numeric UI + copy/paste hotkeys
initTransformLogic(state);

// reference importing + ref copy/paste support
initImportLogic(state);

// save/load functionality import
initSaveLoadLogic(state);

// import model from minecraft command
initImportCommandLogic(state)

// hide sidebar tab
initSidebarToggle(state)

// instructions popup
initInstructionsModal(state)

// buttons to generate commands
initCommandOutputBtns(state)

// ui audio
initAudioTriggers()

// hide grid debug
initDebugVisibilityUI(state);

// setup model library
initModelLibraryModal(state);

// start page animations
await initAnimations(state, clock);

async function revealPage() {
    try {
        if (document.fonts?.ready) {
            await document.fonts.ready;
        }
    } catch (err) {
        console.warn("Font readiness check failed:", err);
    }

    document.documentElement.classList.remove("preload");
}

await revealPage();



