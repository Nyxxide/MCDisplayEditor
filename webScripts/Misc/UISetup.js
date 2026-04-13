// UISetup.js

import {state} from "./StateData.js";
import {entityToSummonCmd, exportOneCommand} from "./CommandBlockLogic.js";

export function initInstructionsModal(state) {
  const openBtn = state.ui.instructionsBtn;
  const modal = document.getElementById("instructionsModal");
  const closeBtn = document.getElementById("instructionsClose");

  if (!openBtn || !modal || !closeBtn) return;

  const SEEN_KEY = "cbt_seen_instructions_v1";

  function openModal() {
    modal.style.display = "flex";
    if (state.orbit) state.orbit.enabled = false;
  }

  function closeModal({ markSeen = true } = {}) {
    modal.style.display = "none";
    if (state.orbit) state.orbit.enabled = true;

    if (markSeen) {
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {}
    }
  }

  function hasSeenInstructions() {
    try {
      return localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  openBtn.addEventListener("click", () => {
    openModal();
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

  // Auto-open on first visit
  if (!hasSeenInstructions()) {
    openModal();
  }

  // Optional debug helper you can call from console:
  // state.api.resetInstructionsSeen?.()
  state.api.resetInstructionsSeen = () => {
    try {
      localStorage.removeItem(SEEN_KEY);
    } catch {}
  };
}

export function initSidebarToggle(state) {
  const mainArea = state.ui.mainArea;
  const sidebar = state.ui.rightSidebar;
  const toggle = state.ui.sidebarToggle;

  if (!mainArea || !sidebar || !toggle) return;

  function applySidebarState(collapsed) {
    sidebar.classList.toggle("collapsed", collapsed);
    mainArea.classList.toggle("sidebar-collapsed", collapsed);
    toggle.textContent = collapsed ? "❮" : "❯";
  }

  toggle.addEventListener("click", () => {
    const collapsed = !sidebar.classList.contains("collapsed");
    applySidebarState(collapsed);
  });

  applySidebarState(false);
}


function clearOutList() {
  while (state.ui.outList.firstChild) state.ui.outList.removeChild(state.ui.outList.firstChild);
}

function addCommandBlock(text) {
  const wrap = document.createElement("div");
  wrap.className = "cmdBlock";

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.readOnly = true;

  const btn = document.createElement("button");
  btn.textContent = "Copy";
  btn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy"), 700);
  });

  wrap.appendChild(ta);
  wrap.appendChild(btn);
  state.ui.outList.appendChild(wrap);
}

export function initCommandOutputBtns(state) {
  state.ui.exportManyBtn?.addEventListener("click", () => {
    clearOutList();
    const lines = state.entities.map((ent) => entityToSummonCmd(ent, "~0.5 ~0.5 ~0.5"));
    lines.forEach(addCommandBlock);
  });

  state.ui.exportOneBtn?.addEventListener("click", () => {
    clearOutList();

    const waves = exportOneCommand(state.entities); // now returns array
    waves.forEach(addCommandBlock);
  });
}

