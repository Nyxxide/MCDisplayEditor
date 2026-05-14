// PaletteUI.js
// ------------
// Searchable block picker UI (keeps minecraft:* under the hood)

const ICON_ATLAS_PNG = "../Data/atlas/icons_atlas.png";
const ICON_ATLAS_JSON = "../Data/atlas/icons_atlas.json";

let iconAtlasMetaPromise = null;

function blockIdToIconKey(blockId) {
    const raw = blockId.startsWith("minecraft:") ? blockId.slice(10) : blockId;
    return `minecraft:${raw}`;
}

async function loadIconAtlasMeta() {
    if (!iconAtlasMetaPromise) {
        iconAtlasMetaPromise = fetch(ICON_ATLAS_JSON, { cache: "no-cache" })
            .then((r) => {
                if (!r.ok) throw new Error(`Failed to load icons atlas: ${r.status}`);
                return r.json();
            });
    }

    return iconAtlasMetaPromise;
}

function applyAtlasIcon(el, blockId, atlasMeta) {
    const key = blockIdToIconKey(blockId);
    const entry = atlasMeta.textures?.[key];

    el.style.backgroundImage = `url("${ICON_ATLAS_PNG}")`;
    el.style.backgroundRepeat = "no-repeat";
    el.style.imageRendering = "pixelated";
    el.style.backgroundSize = `${atlasMeta.atlasW}px ${atlasMeta.atlasH}px`;

    if (!entry) {
        el.style.backgroundImage = "";
        el.style.backgroundColor = "magenta";
        return;
    }

    el.style.backgroundPosition = `-${entry.x}px -${entry.y}px`;
}

function makeIconEl(blockId, atlasMeta, cls = "paletteRowIconImg") {
    const icon = document.createElement("span");
    icon.className = cls;
    icon.setAttribute("aria-hidden", "true");
    applyAtlasIcon(icon, blockId, atlasMeta);
    return icon;
}

function prettyBlockName(blockId) {
    const raw = blockId.startsWith("minecraft:") ? blockId.slice(10) : blockId;
    return raw
        .split("_")
        .map(w => (w ? (w[0].toUpperCase() + w.slice(1)) : w))
        .join(" ");
}

function norm(s) {
    return (s || "").toLowerCase().replace(/[_:\s]+/g, "");
}

export async function initPaletteUI(state, blockIds) {
    const iconAtlasMeta = await loadIconAtlasMeta();

    const root = document.getElementById("palette");
    const btn = document.getElementById("paletteBtn");
    const btnLabel = document.getElementById("paletteBtnLabel");
    const btnIcon = document.getElementById("paletteBtnIcon");
    const popup = document.getElementById("palettePopup");
    const search = document.getElementById("paletteSearch");
    const list = document.getElementById("paletteList");

    if (!root || !btn || !btnLabel || !popup || !search || !list) {
        console.warn("PaletteUI: missing DOM nodes");
        return;
    }

    state.ui.paletteRoot = root;
    state.ui.paletteBtn = btn;
    state.ui.paletteBtnLabel = btnLabel;
    state.ui.paletteBtnIcon = btnIcon;
    state.ui.palettePopup = popup;
    state.ui.paletteSearch = search;
    state.ui.paletteList = list;

    const items = blockIds.map((id) => {
        const label = prettyBlockName(id);
        return { id, label, key: norm(id) + " " + norm(label) };
    });

    let openIndex = 0;
    let filtered = items;

    if (!state.ui.paletteValue) {
        const first = items[0];
        if (first) setSelected(first.id, first.label);
    }

    function setSelected(id, label = null) {
        state.ui.paletteValue = id;
        btnLabel.textContent = label || prettyBlockName(id);

        const selectedIconSlot = state.ui.paletteBtnIcon;
        if (selectedIconSlot) {
            selectedIconSlot.innerHTML = "";
            const icon = makeIconEl(id, iconAtlasMeta, "paletteIconImg");
            selectedIconSlot.appendChild(icon);
        }
    }

    function render(filterText) {
        const q = norm(filterText);

        filtered = [];
        for (const it of items) {
            if (q && !it.key.includes(q)) continue;
            filtered.push(it);
            if (filtered.length >= 250) break;
        }

        if (openIndex < 0) openIndex = 0;
        if (openIndex >= filtered.length) openIndex = filtered.length - 1;
        if (filtered.length === 0) openIndex = 0;

        list.innerHTML = "";

        if (filtered.length === 0) {
            const empty = document.createElement("div");
            empty.className = "paletteRow";
            empty.style.opacity = "0.7";
            empty.textContent = "No matches";
            list.appendChild(empty);
            return;
        }

        filtered.forEach((it, idx) => {
            const row = document.createElement("div");
            row.className = "paletteRow";
            row.dataset.idx = String(idx);

            const icon = makeIconEl(it.id, iconAtlasMeta, "paletteRowIconImg");

            const lab = document.createElement("span");
            lab.className = "paletteRowLabel";
            lab.textContent = it.label;

            row.appendChild(icon);
            row.appendChild(lab);

            if (idx === openIndex) {
                row.style.background = "rgba(255,255,255,.12)";
            }

            row.addEventListener("mouseenter", () => {
                openIndex = idx;
                paintHighlightOnly();
            });

            row.addEventListener("click", () => {
                setSelected(it.id, it.label);
                close();
            });

            list.appendChild(row);
        });

        scrollHighlightedIntoView();
    }

    function paintHighlightOnly() {
        const rows = list.querySelectorAll(".paletteRow");
        rows.forEach((r, i) => {
            r.style.background = (i === openIndex) ? "rgba(255,255,255,.12)" : "";
        });
    }

    function scrollHighlightedIntoView() {
        const row = list.querySelector(`.paletteRow[data-idx="${openIndex}"]`);
        if (!row) return;
        row.scrollIntoView({ block: "nearest" });
    }

    function open() {
        popup.style.display = "block";
        root.dataset.open = "true";
        openIndex = 0;
        render(search.value);

        queueMicrotask(() => {
            search.focus();
            search.select();
        });
    }

    function close() {
        popup.style.display = "none";
        root.dataset.open = "false";
    }

    function toggle() {
        if (popup.style.display === "none" || !popup.style.display) open();
        else close();
    }

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
    });

    search.addEventListener("input", () => render(search.value));

    search.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            close();
            btn.focus();
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (filtered.length) {
                openIndex = Math.min(openIndex + 1, filtered.length - 1);
                paintHighlightOnly();
                scrollHighlightedIntoView();
            }
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (filtered.length) {
                openIndex = Math.max(openIndex - 1, 0);
                paintHighlightOnly();
                scrollHighlightedIntoView();
            }
            return;
        }

        if (e.key === "Enter") {
            if (filtered.length) {
                e.preventDefault();
                const it = filtered[openIndex];
                setSelected(it.id, it.label);
                close();
                btn.focus();
            }
        }
    });

    window.addEventListener("pointerdown", (e) => {
        if (popup.style.display === "none" || !popup.style.display) return;
        if (root.contains(e.target)) return;
        close();
    });

    render("");
}