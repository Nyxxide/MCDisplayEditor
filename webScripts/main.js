// TODO: Fix item icons that appear in the selection menu to match how they appear in editor, fix missing textures
// TODO: Add selection to change dropdown/search between Blocks/Items/Atlases
// TODO: Gotta make my favicon
// TODO: Make Instructions Prettier & Add top bar/xForm stuff into it
// TODO: Make xForm Prettier (Its mostly fine i think, just those arrows i dont really like)
// TODO: Fix nbt behavior on grouping (make grouped objects retain previous values unless new ones are set. Tags append changes to existing, everything else overwrite)
// TODO: Also decide if i want multiselect to prevent nbt modification (probably)
// TODO: Make grid seemingly infinite? and make rendering distance larger. cuts off after a point.


/* TODO Texture Stuff:
*   - Fucking hanging signs (Has necessary props. Yikes)
*   - Wall Variants of signs/banners
*   - Some textures are off but dont worry about it too much. Button texture mapping, regular fire missing outer flat texture, coral fans flip east/west png
*   - Flower pot with flower in too big (because I scale 2D cross elements. just dont scale the potted ones probably.
*   - Gamergeeks my fucking GOAT they have an atlas and a corresponding json. run that up and fix the long standing item icon problem.
*/

/*
*  TODO Housekeeping:
*   - Reogranize Resources to split into Icons/Blocks/Items/Atlases (move everything currently in there for blocks into Blocks folder
*   - For the love of God split the CSS file into multiple it's a mess
*   - Maybe go through all the large webScript files again and see about cutting them down?
*/

/*
*  TODO Long Term Texture Additions:
*   - Every different property render for every block (rotations are pointless, only shit that changes look of block. Toggle in NBT xForm)
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

// hide grid debug
initDebugVisibilityUI(state);

// setup model library
initModelLibraryModal(state);

// start page animations
await initAnimations(state, clock);



