/** FORMEQUA analysis workspace, with the requested blue and gold working palette. */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  let modelFocusActive = false;
  let modelFocusOrigin = null;
  let modelFocusScroll = 0;
  let paletteHome = null;
  let paletteWasCollapsed = true;
  let pendingWorkspaceContext = null;
  let viewerUnavailable = false;
  let focusMassHomes = [];
  let focusPlanHome = null;
  let focusPlanOpen = false;
  let pendingInterior = false;

  function moveFocusPlan(next) {
    const card = byId("realyticsPlanCard"), host = byId("modelFocusPlanHost");
    if (!card || !host) return;
    if (next && card.parentNode !== host) {
      focusPlanHome = document.createComment("Shared floor drawing returns to the analysis panel here.");
      card.before(focusPlanHome); host.append(card);
    } else if (!next && focusPlanHome?.isConnected) {
      focusPlanHome.replaceWith(card); focusPlanHome = null;
    }
  }

  function ensureFocusDetail() {
    if (state.lastComputed?.model?.representation?.detailLevel !== "massing") return;
    const select = byId("selectModelDetail");
    if (select) { select.value = "concept"; select.dispatchEvent(new Event("change", { bubbles: true })); }
  }

  function setFocusPlan(next, generate = false) {
    focusPlanOpen = Boolean(next && modelFocusActive);
    if (focusPlanOpen && generate) ensureFocusDetail();
    const panel = byId("modelFocusPlanPanel");
    if (panel) panel.hidden = !focusPlanOpen;
    document.body.classList.toggle("focus-plan-open", focusPlanOpen);
    byId("btnFocusPlan")?.setAttribute("aria-expanded", String(focusPlanOpen));
    moveFocusPlan(focusPlanOpen);
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  function openFocusInterior(level = state.selectedFloorLevel, view = "overview", origin = "manual") {
    if (!modelFocusActive || pendingInterior) return;
    pendingInterior = true;
    setFocusPlan(true, true);
    requestAnimationFrame(() => {
      pendingInterior = false;
      if (!modelFocusActive) return;
      const floors = state.lastComputed?.model?.floorPlates || [];
      const selected = floors.find(fp => fp.level === level)
        || floors.find(fp => fp.level === Number(byId("realyticsFloorSelect")?.value)) || floors[0];
      if (!selected) return;
      window.dispatchEvent(new CustomEvent("atelier:select-floor", { detail: { level: selected.level } }));
      window.AtelierInteriorViewer?.open(selected.level, { origin, view });
    });
  }

  function moveFocusMassControls(next) {
    const host = byId("modelFocusMassControls");
    if (!host) return;
    if (next && !focusMassHomes.length) {
      ["sliderFloorsAbove", "sliderFloorHeight", "sliderTargetBcr"].forEach(id => {
        const row = byId(id)?.closest(".control-row");
        if (!row) return;
        const home = document.createComment("Shared mass input returns to the workbench here.");
        row.before(home); host.append(row); focusMassHomes.push({ row, home });
      });
    } else if (!next) {
      focusMassHomes.forEach(({ row, home }) => { if (home.isConnected) home.replaceWith(row); });
      focusMassHomes = [];
    }
  }

  function selectFocusTab(tab, focus = false) {
    const shape = tab !== "material";
    ["shape", "material"].forEach(name => {
      const selected = (name === "shape") === shape;
      const button = byId(name === "shape" ? "modelFocusShapeTab" : "modelFocusMaterialTab");
      const panel = byId(name === "shape" ? "modelFocusShapePanel" : "modelFocusMaterialPanel");
      if (button) { button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; }
      if (panel) panel.hidden = !selected;
      if (selected && focus) button?.focus({ preventScroll: true });
    });
  }

  function syncFocusMass() {
    document.querySelectorAll("[data-focus-option]").forEach(button => {
      const selected = button.dataset.focusOption === state.option;
      button.setAttribute("aria-pressed", String(selected));
    });
    const model = state.lastComputed?.model;
    if (!model) return;
    const height = Number(model.buildingHeightM), floors = Number(model.actualFloorsAbove);
    const heightLabel = byId("modelFocusHeight"), scale = byId("modelFocusScale"), note = byId("modelFocusMassNote");
    if (heightLabel) heightLabel.textContent = Number.isFinite(height) ? `${height.toFixed(1)} m` : "— m";
    if (scale) scale.textContent = `적용 ${floors}층 / 요청 ${state.floorsAbove}층 · 기준층 층고 ${Number(state.floorHeight).toFixed(1)} m`;
    if (note) {
      const limited = floors < Number(state.floorsAbove);
      note.classList.toggle("is-limited", limited);
      note.textContent = limited
        ? `요청 ${state.floorsAbove}층 중 ${floors}층이 적용되었습니다. 대지·용적률·높이·주차·코어 조건에 따라 규모가 제한될 수 있습니다.`
        : "층수·층고·바닥 면적을 조정하면 모형과 면적·주차·사업성이 함께 갱신됩니다. 법정 상한과 대지 조건은 유지됩니다.";
    }
  }

  function moveFocusPalette(next) {
    const studio = byId("hudFacadeQuickStudio"), host = byId("modelFocusPaletteHost");
    const panel = byId("modelFocusPalette");
    if (panel) panel.hidden = !next;
    if (!studio || !host) return;
    if (next && studio.parentNode !== host) {
      paletteWasCollapsed = studio.classList.contains("collapsed");
      paletteHome = document.createComment("Exterior palette returns here in the workbench.");
      studio.before(paletteHome); host.append(studio);
      studio.classList.remove("collapsed");
    } else if (!next && paletteHome?.isConnected) {
      paletteHome.replaceWith(studio); paletteHome = null;
      studio.classList.toggle("collapsed", paletteWasCollapsed);
    }
  }

  function syncFocusScene() {
    if (typeof dimensionGroup !== "undefined" && dimensionGroup) dimensionGroup.visible = !modelFocusActive && !!state.showDimensions;
  }

  function applyWorkspaceContext() {
    const context = pendingWorkspaceContext;
    pendingWorkspaceContext = null;
    if (context?.tab) showAnalysis(context.tab, context.drawer, false);
    else if (context?.chapter) showDesign(context.chapter, false);
  }

  function setModelFocus(next, restoreFocus = true) {
    const grid = byId("workspaceGrid");
    if (!grid) return;
    next = Boolean(next);
    if (next === modelFocusActive && grid.classList.contains("gallery-mode") === next && document.body.classList.contains("model-focus") === next) return;
    const wasActive = modelFocusActive;
    if (next && !wasActive) {
      modelFocusOrigin = document.activeElement === document.body ? null : document.activeElement;
      modelFocusScroll = window.scrollY;
      grid.classList.remove("wide-analytics");
    }
    modelFocusActive = next;
    if (!next && wasActive) window.AtelierModelVideo?.stop();
    grid.classList.toggle("gallery-mode", next);
    document.body.classList.toggle("model-focus", next);
    moveFocusPalette(next);
    moveFocusMassControls(next);
    if (!next) setFocusPlan(false);
    syncFocusScene();
    const toolbar = document.querySelector(".model-focus-toolbar");
    if (toolbar) toolbar.hidden = !next;
    if (next) byId("btnExitModelFocus")?.focus({ preventScroll: true });
    else {
      window.scrollTo({ top: modelFocusScroll, behavior: "instant" });
      if (restoreFocus) (modelFocusOrigin?.isConnected ? modelFocusOrigin : byId("btnToggleGalleryMode"))?.focus({ preventScroll: true });
      applyWorkspaceContext();
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next ? "model" : "workspace");
      window.history.replaceState(window.history.state, "", url);
    } catch (_) { /* The view remains usable if history is restricted. */ }
    syncAppearance();
    // The renderer also observes its stage, but this covers older browsers and split-view changes.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    window.dispatchEvent(new CustomEvent("atelier:model-focus", { detail: { active: next } }));
  }
  window.AtelierModelFocus = {
    set: setModelFocus,
    toggle: () => setModelFocus(!modelFocusActive),
    isActive: () => modelFocusActive
  };
  const palette = {
    "#ffffff": "#ffffff", "#fff": "#ffffff", "#f8fafc": "#f3f7fc", "#f1f5f9": "#edf2f8", "#e2e8f0": "#dce5f1",
    "#111827": "#182742", "#0f172a": "#182742", "#1e293b": "#253c5b", "#334155": "#415977", "#475569": "#536781", "#64748b": "#64748b", "#94a3b8": "#8396b0",
    "#1e3a8a": "#174aaf", "#1d4ed8": "#215bd4", "#2563eb": "#215bd4", "#3b82f6": "#477de0", "#60a5fa": "#739ee8", "#93c5fd": "#adc8f4", "#dbeafe": "#e1ebfc", "#eff6ff": "#f0f5ff",
    "#0284c7": "#16859d", "#06b6d4": "#159ab7", "#0ea5e9": "#199bb9", "#22d3ee": "#28b7d7", "#38bdf8": "#53bfd9", "#7dd3fc": "#9fdcea",
    "#047857": "#087c70", "#059669": "#0b8a78", "#10b981": "#229f89", "#34d399": "#61bca6", "#4ade80": "#67b99d", "#22c55e": "#29977c", "#ecfdf5": "#e9f7f3",
    "#a16207": "#896323", "#b45309": "#946729", "#d97706": "#aa7b36", "#f59e0b": "#bd965e", "#fbbf24": "#d1ae75", "#fef3c7": "#fbf1dd",
    "#5b21b6": "#5c5799", "#7c3aed": "#6860a9", "#8b5cf6": "#837bbe", "#a855f7": "#9586c3", "#6366f1": "#6a73ba", "#c7d2fe": "#dedff4",
    "#be123c": "#a03647", "#e11d48": "#b34150", "#f43f5e": "#c86070", "#ef4444": "#be4a58", "#fb7185": "#dc8f9a"
  };

  function tone(value) {
    return value.replace(/#[\da-f]{3,8}\b/gi, color => palette[color.toLowerCase()] || color)
      .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(\s*,\s*[\d.]+\s*)?\)/gi, (full, r, g, b, alpha) => {
        const key = "#" + [r,g,b].map(n => Number(n).toString(16).padStart(2,"0")).join("");
        const mapped = palette[key];
        if (!mapped) return full;
        const rgb = [1,3,5].map(index => parseInt(mapped.slice(index,index+2),16));
        return alpha ? `rgba(${rgb.join(",")}${alpha})` : `rgb(${rgb.join(",")})`;
      });
  }

  function syncAppearance() {
    syncFocusMass();
    document.querySelectorAll(".dashboard-site [style]").forEach(el => {
      if (el.closest("[data-preserve-color]")) return;
      const style = el.getAttribute("style"), next = tone(style);
      if (next !== style) el.setAttribute("style", next);
    });
    document.querySelectorAll(".dashboard-site svg [fill],.dashboard-site svg [stroke]").forEach(el => {
      if (el.closest("[data-preserve-color]")) return;
      ["fill","stroke"].forEach(attr => {
        const value = el.getAttribute(attr);
        if (value) { const next = tone(value); if (next !== value) el.setAttribute(attr,next); }
      });
    });
    const grid = byId("workspaceGrid");
    const gallery = byId("btnToggleGalleryMode"), theme = byId("btnToggleStudioTheme"), expand = byId("btnExpandAnalytics");
    if (gallery && grid) {
      const focused = grid.classList.contains("gallery-mode");
      gallery.textContent = focused ? "상세 작업실로 돌아가기" : "모형 집중";
      gallery.setAttribute("aria-pressed", String(focused));
    }
    if (theme) {
      theme.textContent = state.daylightTheme ? "야간 모형" : "주간 모형";
      theme.setAttribute("aria-pressed", String(!state.daylightTheme));
    }
    if (expand && grid) expand.textContent = grid.classList.contains("wide-analytics") ? "기본 폭 ↗" : "분석 넓히기 ↗";
    const quick = byId("btnToggleQuickStudio");
    if (quick) {
      const expanded = !byId("hudFacadeQuickStudio")?.classList.contains("collapsed");
      quick.textContent = expanded ? "외관 팔레트 접기 −" : "외관 팔레트 열기 +";
      quick.setAttribute("aria-expanded", String(expanded));
      quick.setAttribute("aria-label", expanded ? "외관 팔레트 접기" : "외관 팔레트 열기");
    }
    document.querySelectorAll("#hudFacadeQuickStudio button[data-qfacade],#hudFacadeQuickStudio button[data-qmat],#hudFacadeQuickStudio button[data-qaccent],#hudFacadeQuickStudio button[data-qglass]")
      .forEach(button => button.setAttribute("aria-pressed", String(button.classList.contains("active"))));
    const dimensions = byId("btnToggleQuickDim");
    if (dimensions) { dimensions.textContent = state.showDimensions ? "치수선 켜짐" : "치수선 꺼짐"; dimensions.setAttribute("aria-pressed", String(state.showDimensions)); }
    const focusInterior = byId("btnFocusInterior");
    if (focusInterior) {
      focusInterior.textContent = document.body.classList.contains("interior-active") ? "외관 보기" : "3D 실내 보기";
      focusInterior.disabled = !document.body.classList.contains("interior-active")
        && (!state.lastComputed?.model?.floorPlates?.length || state.lastComputed?.model?.coreLayout?.status === "unfeasible");
    }
    if (byId("btnFocusPlan")) byId("btnFocusPlan").disabled = !state.lastComputed?.model?.floorPlates?.length;
  }

  function focusPanel(kind, target, focus = true) {
    const panel = byId(kind === "design" ? "dashboardDesignPanel" : "dashboardAnalysisPanel");
    const modelPanel = byId("dashboardModelPanel");
    if (!panel) return;
    const stacked = modelPanel && panel.getBoundingClientRect().top >= modelPanel.getBoundingClientRect().bottom - 2;
    const scroller = kind === "analysis" ? panel.querySelector(".tab-content.active") : panel;
    const scrollsInside = scroller && ["auto","scroll"].includes(getComputedStyle(scroller).overflowY);
    if (stacked) (scrollsInside ? panel : target || panel).scrollIntoView({ behavior: "instant", block: "start" });
    if (target && scrollsInside) {
      if (scroller === target) scroller.scrollTop = 0;
      else scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20;
    }
    if (focus) panel.focus({ preventScroll: true });
  }

  function showAnalysis(tabId, drawerId, focus = true) {
    const tab = byId(tabId);
    if (!tab?.classList.contains("tab-content")) return;
    if (modelFocusActive) setModelFocus(false, false);
    byId("workspaceGrid")?.classList.remove("gallery-mode");
    document.querySelectorAll(".tab-btn").forEach(button => {
      const selected = button.dataset.tab === tabId;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll(".tab-content").forEach(content => content.classList.toggle("active", content === tab));
    const detail = byId(drawerId);
    if (detail?.tagName === "DETAILS" && tab.contains(detail)) detail.open = true;
    focusPanel("analysis", detail || tab, focus);
    syncAppearance();
  }

  function showDesign(chapterId, focus = true) {
    const chapter = byId(chapterId);
    if (!chapter?.classList.contains("atelier-chapter")) return;
    if (modelFocusActive) setModelFocus(false, false);
    document.querySelectorAll(".atelier-chapter").forEach(el => el.classList.toggle("open", el === chapter));
    focusPanel("design", chapter, focus);
  }

  window.addEventListener("atelier:updated", () => {
    syncAppearance();
    syncFocusScene();
    const status = byId("workspaceSaveStatus");
    if (status) status.textContent = "설계 조건 이어서 편집";
  });
  window.addEventListener("atelier:scene-rebuilt", syncFocusScene);
  window.addEventListener("atelier:plan-selected", () => moveFocusPlan(focusPlanOpen && modelFocusActive));
  window.addEventListener("atelier:floor-selected", event => {
    if (!modelFocusActive) return;
    const level = event.detail?.level;
    setFocusPlan(true, level > 0);
    if (Number.isInteger(level)) window.dispatchEvent(new CustomEvent("atelier:select-floor", { detail: { level } }));
  });
  window.addEventListener("atelier:interior-change", event => {
    if (modelFocusActive && event.detail?.active) setFocusPlan(true);
    syncAppearance();
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  });
  window.addEventListener("atelier:interior-request", event => {
    if (modelFocusActive && event.detail?.origin === "auto") openFocusInterior(event.detail.level, "perspective", "auto");
  });
  window.addEventListener("atelier:open-design", event => showDesign(event.detail?.chapterId));
  window.addEventListener("atelier:open-analysis", event => showAnalysis(event.detail?.tabId));
  window.addEventListener("atelier:viewer-unavailable", () => {
    viewerUnavailable = true;
    setModelFocus(false, false);
    const stage = byId("threeStage");
    if (!stage) return;
    const fallback = document.createElement("div");
    fallback.className = "workspace-viewer-fallback";
    fallback.textContent = "3D 화면을 불러오지 못했습니다. 설계 조건과 분석 자료는 계속 편집할 수 있습니다.";
    stage.append(fallback);
  });

  window.addEventListener("DOMContentLoaded", () => {
    syncAppearance();
    document.querySelectorAll("[data-focus-tab]").forEach(button => {
      button.addEventListener("click", () => selectFocusTab(button.dataset.focusTab));
      button.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tab = event.key === "Home" ? "shape" : event.key === "End" ? "material" : button.dataset.focusTab === "shape" ? "material" : "shape";
        selectFocusTab(tab, true);
      });
    });
    document.querySelectorAll("[data-focus-option]").forEach(button => button.addEventListener("click", () => {
      // Invoke the canonical option control so calculations and saved inputs
      // use precisely the same update path as the complete workbench.
      document.querySelector(`.option-card[data-option="${button.dataset.focusOption}"]`)?.click();
    }));
    byId("btnExitModelFocus")?.addEventListener("click", () => setModelFocus(false));
    byId("btnFocusPlan")?.addEventListener("click", () => setFocusPlan(!focusPlanOpen, !focusPlanOpen));
    byId("btnCloseFocusPlan")?.addEventListener("click", () => { setFocusPlan(false); byId("btnFocusPlan")?.focus({ preventScroll: true }); });
    byId("btnFocusInterior")?.addEventListener("click", () => {
      if (document.body.classList.contains("interior-active")) window.AtelierInteriorViewer?.exit();
      else openFocusInterior();
    });
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && !event.defaultPrevented && modelFocusActive && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        setModelFocus(false);
      }
    });
    const grid = byId("workspaceGrid");
    if (grid) new MutationObserver(() => {
      // Existing analysis links can exit gallery-mode; keep the full-window surface in sync.
      setModelFocus(grid.classList.contains("gallery-mode"));
    }).observe(grid, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(() => {
      const focusInterior = byId("btnFocusInterior");
      if (focusInterior) focusInterior.textContent = document.body.classList.contains("interior-active") ? "외관 보기" : "3D 실내 보기";
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    let pendingScroll = false;
    const updateJumpbar = () => { document.body.classList.toggle("workspace-scrolled", window.scrollY > 240); pendingScroll = false; };
    window.addEventListener("scroll", () => { if (!pendingScroll) { pendingScroll = true; requestAnimationFrame(updateJumpbar); } }, { passive: true });
    updateJumpbar();
    const context = window.AtelierWorkspace?.getContext() || {};
    pendingWorkspaceContext = context;
    // Leaving the work surface always opens the homepage at its beginning.
    document.querySelectorAll("[data-workspace-return]").forEach(link => { link.href = "./#home"; });
    document.querySelectorAll(".kpi-cell[data-kpitab]").forEach(cell => {
      const label = cell.querySelector(".kpi-label > span")?.textContent?.replace(/^\d+\s*·\s*/, "") || "분석";
      cell.tabIndex = 0; cell.setAttribute("role", "button"); cell.setAttribute("aria-label", `${label} 상세 보기`);
      const activate = () => showAnalysis(cell.dataset.kpitab, cell.dataset.kpidrawer);
      cell.addEventListener("click", activate);
      cell.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } });
    });
    ["btnToggleGalleryMode","btnToggleStudioTheme","btnExpandAnalytics","btnToggleQuickStudio","btnToggleQuickDim"].forEach(id => byId(id)?.addEventListener("click", syncAppearance));
    byId("btnToggleSmap")?.addEventListener("click", () => {
      const frame = byId("smapIframe");
      if (frame?.dataset.src && frame.getAttribute("src") === "about:blank") frame.src = frame.dataset.src;
    }, { capture: true });
    document.querySelectorAll(".workspace-section-nav a").forEach(link => link.addEventListener("click", () => {
      if (link.hash === "#dashboardAnalysisPanel") byId("workspaceGrid")?.classList.remove("gallery-mode");
    }));
    const requestedView = new URL(window.location.href).searchParams.get("view");
    setModelFocus(!viewerUnavailable && requestedView !== "workspace", false);
    if (!modelFocusActive) applyWorkspaceContext();
  });
})();
