// PaletteUI.js
// ------------
// Searchable block picker UI (keeps minecraft:* under the hood)

const LOCAL_ICON_BASE = "../Resources/icons/";  // adjust to your folder
const MISSING_ICON_URL = "../Resources/icons/__missing_texture.png"; // add one placeholder png

function blockIdToIconStem(blockId) {
    return blockId.startsWith("minecraft:") ? blockId.slice(10) : blockId;
}

function localIconUrl(blockId) {
    return `${LOCAL_ICON_BASE}${blockIdToIconStem(blockId)}.png`;
}

function makeIconImg(blockId) {
    const img = document.createElement("img");
    img.className = "paletteRowIconImg";
    img.alt = "";
    img.draggable = false;
    img.loading = "lazy";
    img.decoding = "async";

    img.src = localIconUrl(blockId);
    img.onerror = () => {
        img.onerror = null;
        img.src = MISSING_ICON_URL;
    };

    return img;
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

export function initPaletteUI(state, blockIds) {
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

    // store on state (under-the-hood selection)
    state.ui.paletteRoot = root;
    state.ui.paletteBtn = btn;
    state.ui.paletteBtnLabel = btnLabel;
    state.ui.paletteBtnIcon = btnIcon;
    state.ui.palettePopup = popup;
    state.ui.paletteSearch = search;
    state.ui.paletteList = list;

    // data: precompute display strings so filtering is fast
    const items = blockIds.map((id) => {
        const label = prettyBlockName(id);
        return { id, label, key: norm(id) + " " + norm(label) };
    });

    let openIndex = 0;      // highlighted row index in the *filtered* list
    let filtered = items;   // current filtered list

    // default selection: first item (or keep current if already set)
    if (!state.ui.paletteValue) {
        const first = items[0];
        if (first) setSelected(first.id, first.label);
    }

    function setSelected(id, label = null) {
        state.ui.paletteValue = id;              // ✅ USE THIS EVERYWHERE
        btnLabel.textContent = label || prettyBlockName(id);
        const btnIcon = state.ui.paletteBtnIcon;
        if (btnIcon) {
            btnIcon.innerHTML = "";

            const img = document.createElement("img");
            img.className = "paletteIconImg";
            img.alt = "";
            img.draggable = false;
            img.loading = "eager";
            img.decoding = "async";

            img.src = localIconUrl(id);

            img.onerror = () => {
                img.onerror = null;
                img.src = MISSING_ICON_URL;
            };

            btnIcon.appendChild(img);
        }
    }

    function render(filterText) {
        const q = norm(filterText);

        // build filtered list
        filtered = [];
        for (const it of items) {
            if (q && !it.key.includes(q)) continue;
            filtered.push(it);
            if (filtered.length >= 250) break;
        }

        // clamp highlight
        if (openIndex < 0) openIndex = 0;
        if (openIndex >= filtered.length) openIndex = filtered.length - 1;
        if (filtered.length === 0) openIndex = 0;

        // draw
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

            const icon = makeIconImg(it.id)

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

        // ensure highlighted row is visible
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

    // open/close
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
    });

    // typing filters list
    search.addEventListener("input", () => render(search.value));

    // click outside closes
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
            // choose highlighted
            if (filtered.length) {
                e.preventDefault();
                const it = filtered[openIndex];
                setSelected(it.id, it.label);
                close();
                btn.focus();
            }
            return;
        }
    });

    window.addEventListener("pointerdown", (e) => {
        // only care if open
        if (popup.style.display === "none" || !popup.style.display) return;

        // click inside palette = ignore
        if (root.contains(e.target)) return;

        // otherwise close
        close();
    });


    // initial render for first open
    render("");
}
