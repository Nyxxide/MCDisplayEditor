const uiGenericClickSound = new Audio("../Static/Audio/GenericButton.mp3");
const uiSaveClickSound = new Audio("../Static/Audio/SaveButton.mp3");
const uiLoadClickSound = new Audio("../Static/Audio/LoadButton.mp3");
const uiImport3DClickSound = new Audio("../Static/Audio/Import3DModelButton.mp3");
const uiImportViaCMDSound = new Audio("../Static/Audio/ImportViaCmdButton.mp3");
const uiInstructionClickSound = new Audio("../Static/Audio/InstructionsButton.mp3");
const uiInvisGridClickSound = new Audio("../Static/Audio/InvisGridButton.mp3");
const uiModelLibraryClickSound = new Audio("../Static/Audio/ModelLibraryButton.mp3");
const modalImportClickSound = new Audio("../Static/Audio/ImportedCommand.mp3");

uiGenericClickSound.preload = "auto";
uiSaveClickSound.preload = "auto";
uiLoadClickSound.preload = "auto";
uiImport3DClickSound.preload = "auto";
uiImportViaCMDSound.preload = "auto";
uiInstructionClickSound.preload = "auto";
uiInvisGridClickSound.preload = "auto";
uiModelLibraryClickSound.preload = "auto";
modalImportClickSound.preload = "auto";


export function playUiClick(audio = uiGenericClickSound) {
    const s = audio.cloneNode()
    s.play().catch(() => {});
}

function bindClickSound(selector, audio) {
    document.querySelectorAll(selector).forEach((el) => {
        el.addEventListener("click", () => {
            playUiClick(audio);
        });
    });
}

export function initAudioTriggers() {
    bindClickSound(".modalClose");
    bindClickSound("#exportOne, #exportMany");
    bindClickSound(".modeSwitches button");
    bindClickSound("#saveBtn", uiSaveClickSound);
    bindClickSound("#loadBtn", uiLoadClickSound);
    bindClickSound("#instructionsBtn", uiInstructionClickSound);
    bindClickSound("#importRefBtn", uiImport3DClickSound);
    bindClickSound("#importCmdBtn", uiImportViaCMDSound);
    bindClickSound("#importCmdRun", modalImportClickSound);
    bindClickSound("#toggleGridBtn", uiInvisGridClickSound);
    bindClickSound("#modelLibraryBtn", uiModelLibraryClickSound);
}