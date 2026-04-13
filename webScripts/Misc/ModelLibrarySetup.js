// ModelLibrarySetup.js
// --------------------
// Model library modal + manifest loading.

import {playUiClick} from "./AudioControl.js";

export function initModelLibraryModal(state) {
    const openBtn = state.ui.modelLibraryBtn;
    const modal = document.getElementById("modelLibraryModal");
    const closeBtn = document.getElementById("modelLibraryClose");
    const grid = document.getElementById("modelLibraryGrid");

    if (!openBtn || !modal || !closeBtn || !grid) return;

    const MANIFEST_URL = "/Models/manifest.json";

    function openModal() {
        modal.style.display = "flex";
        if (state.orbit) state.orbit.enabled = false;
    }

    function closeModal() {
        modal.style.display = "none";
        if (state.orbit) state.orbit.enabled = true;
    }

    function clearGrid() {
        while (grid.firstChild) grid.removeChild(grid.firstChild);
    }

    function showMessage(cls, text) {
        clearGrid();
        const div = document.createElement("div");
        div.className = cls;
        div.textContent = text;
        grid.appendChild(div);
    }

    function buildModelUrl(folder, file) {
        return `/Models/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
    }

    function makeCard(model) {
        const card = document.createElement("div");
        card.className = "modelLibraryCard";

        const preview = document.createElement("div");
        preview.className = "modelLibraryPreview";

        const img = document.createElement("img");
        img.src = buildModelUrl(model.folder, model.image);
        img.alt = model.name;

        const hover = document.createElement("div");
        hover.className = "modelLibraryHover";

        const loadBtn = document.createElement("button");
        loadBtn.className = "modelLibraryLoadBtn";
        loadBtn.type = "button";
        loadBtn.textContent = "Load Model";

        loadBtn.addEventListener("click", async (e) => {
            e.stopPropagation();

            try {
                const importAudio = new Audio("../Static/Audio/ImportedCommand.mp3");
                playUiClick(importAudio);
                loadBtn.disabled = true;
                loadBtn.textContent = "Loading...";

                const res = await fetch(buildModelUrl(model.folder, model.json), { cache: "no-cache" });
                if (!res.ok) throw new Error(`Failed to load model JSON: ${res.status}`);

                const data = await res.json();
                await state.api.loadSaveDataMerge?.(data);

                closeModal();
            } catch (err) {
                console.error(err);
                alert(`Failed to load model: ${err?.message || err}`);
            } finally {
                loadBtn.disabled = false;
                loadBtn.textContent = "Load Model";
            }
        });

        hover.appendChild(loadBtn);
        preview.appendChild(img);
        preview.appendChild(hover);

        const banner = document.createElement("div");
        banner.className = "modelLibraryBanner";
        banner.textContent = model.name;

        card.appendChild(preview);
        card.appendChild(banner);

        return card;
    }

    async function populateLibrary() {
        try {
            showMessage("modelLibraryEmpty", "Loading library...");

            const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
            if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);

            const manifest = await res.json();
            const models = Array.isArray(manifest.models) ? manifest.models : [];

            if (models.length === 0) {
                showMessage("modelLibraryEmpty", "No models found.");
                return;
            }

            clearGrid();
            for (const model of models) {
                if (!model?.name || !model?.folder || !model?.json || !model?.image) continue;
                grid.appendChild(makeCard(model));
            }
        } catch (err) {
            console.error(err);
            showMessage("modelLibraryError", `Failed to load model library.`);
        }
    }

    openBtn.addEventListener("click", async () => {
        openModal();
        await populateLibrary();
    });

    closeBtn.addEventListener("click", () => {
        closeModal();
    });

    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.style.display !== "none") {
            closeModal();
        }
    });
}