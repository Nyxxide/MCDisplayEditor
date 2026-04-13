// TODO: Fix item icons that appear in the selection menu to match how they appear in editor, fix missing textures
// TODO: Add selection to change dropdown/search between Blocks/Items/Atlases
// TODO: Make UI look nicer, add button toggles for every keystroke
// TODO: Change BlockData UI in the top right corner to only reflect the values of the given mode (dont show all 3 all the time)
// TODO: Make click and drag move (not via gizmo) not lock into intervals of 0.25, instead +/- shift of 0.25
// TODO: When multi-selected and not grouped, copy/paste makes them a group upon pasting?
// TODO: Add Tagging in the block/group specific UI (change how block data is stored backend again, esp with save/load)
// TODO: Make entire grid floor have toggleable visibility (screencap purposes)
// TODO: Add button for library of default models (Currently only T-Rex)
// TODO: Look at latest gpt message for fix on modal editor blocking


/* TODO Texture Stuff:
*   - Fucking hanging signs
*   - Wall Variants of signs/banners
*   - Some textures are off but dont worry about it too much. Buttons are of note right now but that's all I'm aware of
*/

/*
*  TODO Housekeeping:
*   - Reogranize Resources to split into Icons/Blocks/Items/Atlases (move everything currently in there for blocks into Blocks folder
*/

/*
*  TODO Long Term Texture Additions:
*   - Every different property render for every block (rotations are pointless, only shit that changes look of block)
*   - Item Displays
*   - Text Displays with every possible atlas texture
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
import { initCommandOutputBtns, initInstructionsModal, initSidebarToggle, initAudioTriggers } from "./Misc/UISetup.js";



// -------------------- Init --------------------
const clock = new THREE.Clock();

initDom();
await initScene(state);

// palette blocks
const BLOCKS = await loadBlockList();

// fill palette
initPaletteUI(state, BLOCKS);

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

// start page animations
await initAnimations(state, clock);



