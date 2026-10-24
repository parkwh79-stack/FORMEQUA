/** AI-only, anonymous visual portfolio. Never restores a visitor's project or inputs. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else api.mount(root);
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  const ID = /^[a-zA-Z0-9_-]{8,80}$/;
  const PROGRAMS = Object.freeze({ office: ["OFFICE", "오피스"], officetel: ["OFFICETEL", "오피스텔"], hotel: ["HOTEL", "호텔"], housing: ["HOUSING", "주거"], living: ["CO-LIVING", "리빙"], knowledge: ["WORKPLACE", "업무공간"], retail: ["RETAIL", "근린생활"], sales: ["RETAIL", "판매시설"] });
  const PAGE_SIZE = 6;
  const API_PAGE_LIMIT = 60;
  const numeric = (value, max) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;

  function normalizeStudy(value, origin) {
    if (!value || typeof value !== "object" || !ID.test(value.id || "") || !Object.hasOwn(PROGRAMS, value.program)) return null;
    if (value.source !== "pilot-study" || value.imageKind !== "ai-concept" || !Number.isInteger(value.renderVersion) || value.renderVersion < 2 || value.renderVersion > 100) return null;
    let imageUrl;
    try {
      const url = new URL(value.imageUrl, origin);
      if (url.origin !== origin || url.pathname !== `/api/v1/studies/${value.id}/image.png` || url.search || url.hash || url.username || url.password) return null;
      // The source URL has no parameters. Add only our validated render version
      // so an upgraded image cannot reuse the browser's decoded old thumbnail.
      imageUrl = `${url.pathname}?v=${value.renderVersion}`;
    } catch (_) { return null; }
    // Text is generated from the permitted use rather than reflecting arbitrary API strings.
    const program = PROGRAMS[value.program];
    return Object.freeze({ id: value.id, imageKind: "ai-concept", programKr: program[1], title: `${program[1]} AI 건축 이미지`, imageUrl,
      renderVersion: value.renderVersion, createdAt: typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) ? value.createdAt : null });
  }

  function mergePage(previous, payload, origin, refresh = false) {
    if (!payload || !Array.isArray(payload.studies) || payload.studies.length > API_PAGE_LIMIT) return null;
    const total = numeric(payload.total, 1000000);
    if (!Number.isInteger(total) || !(payload.nextOffset === null || (Number.isInteger(payload.nextOffset) && payload.nextOffset > 0 && payload.nextOffset < total))) return null;
    const incoming = payload.studies.map(value => normalizeStudy(value, origin)).filter(Boolean);
    const byId = new Map(previous.records.map(study => [study.id, study]));
    incoming.forEach(study => byId.set(study.id, study));
    const records = [...byId.values()].sort((a, b) => {
      const time = (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0);
      return time || b.id.localeCompare(a.id, "en");
    });
    let nextOffset = payload.nextOffset;
    if (refresh && previous.records.length) {
      const added = total - previous.total;
      // Normal append-only updates shift the offset without throwing away previously loaded pages.
      // A larger burst restarts the cursor at the newest page so no unseen middle pages are skipped.
      if (added >= 0 && added <= incoming.length) nextOffset = previous.nextOffset === null ? null : previous.nextOffset + added;
    }
    if (records.length >= total || nextOffset >= total) nextOffset = null;
    return { records, total: Math.max(total, records.length), nextOffset };
  }

  function mount(window) {
    const document = window.document;
    if (!document) return;
    const initialize = () => {
      const section = document.getElementById("studyAiDirection");
      const grid = document.getElementById("publicStudiesGrid");
      const referenceCard = document.getElementById("aiReferenceStudy");
      const referenceButton = document.getElementById("btnAiReferenceStudy");
      const more = document.getElementById("btnMorePublicStudies");
      const status = document.getElementById("publicStudiesStatus");
      if (!section || !grid || !referenceCard || !referenceButton || !more || !status) return;
      let collection = { records: [], total: 0, nextOffset: null }, count = PAGE_SIZE, inFlight = false, lastRequestedAt = 0;
      const cards = new Map();
      const isPortfolioHash = () => ["#ongoingStudies", "#studyAiDirection"].includes(window.location.hash);
      const revealAnchor = () => {
        if (window.location.hash === "#ongoingStudies") {
          if (typeof window.history?.replaceState === "function") window.history.replaceState(null, "", "#studyAiDirection");
          window.requestAnimationFrame(() => section.scrollIntoView({ block: "start", behavior: "instant" }));
        }
      };
      let activeDialog = null;
      const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      };
      const image = study => {
        const frame = element("div", "public-study-image");
        const img = element("img");
        img.src = study.imageUrl;
        img.alt = `${study.programKr} AI 건축 콘셉트 이미지 · 실제 준공 사진이 아닙니다`;
        img.width = 1536; img.height = 1024; img.loading = "lazy"; img.decoding = "async";
        const fallback = element("span", "public-study-image-fallback", "이미지를 불러오지 못했습니다.");
        fallback.hidden = true;
        img.addEventListener("error", () => { img.hidden = true; fallback.hidden = false; }, { once: true });
        frame.append(img, fallback);
        return frame;
      };
      const closeDialog = () => {
        if (!activeDialog) return;
        const { node, trigger } = activeDialog;
        activeDialog = null;
        if (typeof node.close === "function") node.close();
        node.remove();
        trigger?.focus({ preventScroll: true });
      };
      const openStudy = (study, trigger) => {
        closeDialog();
        const dialog = element("dialog", "public-study-dialog");
        const headingId = `public-study-title-${study.id}`;
        dialog.setAttribute("aria-labelledby", headingId);
        const close = element("button", "public-study-close", "닫기 ×");
        close.type = "button"; close.autofocus = true;
        close.addEventListener("click", closeDialog);
        const kicker = element("p", "section-kicker", "AI VISUAL STUDY");
        const heading = element("h2", "public-study-dialog-title", study.title);
        heading.id = headingId;
        const note = element("p", "public-study-disclaimer", "조감도를 바탕으로 표현한 AI 개념 이미지입니다. 실제 준공 사진이나 확정 설계안이 아닙니다.");
        dialog.append(close, kicker, heading, image(study), note);
        dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog(); });
        dialog.addEventListener("click", event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
        document.body.append(dialog);
        activeDialog = { node: dialog, trigger };
        if (typeof dialog.showModal === "function") dialog.showModal();
        else { dialog.setAttribute("open", ""); close.focus(); }
      };
      referenceButton.addEventListener("click", () => openStudy({ id: "reference", title: "Architectural concept", programKr: "참고", imageUrl: "assets/study-ai-architecture-v1.png" }, referenceButton));
      const render = () => {
        const fragment = document.createDocumentFragment();
        fragment.append(referenceCard);
        collection.records.slice(0, count).forEach((study, index) => {
          const cardKey = `${study.id}:${study.renderVersion}`;
          if (cards.has(cardKey)) {
            const article = cards.get(cardKey);
            article.children[0]?.setAttribute("aria-label", `${study.title} 크게 보기`);
            const caption = article.children[0]?.children[1]?.children[0];
            if (caption) caption.textContent = `Visual study ${String(index + 1).padStart(2, "0")}`;
            fragment.append(article); return;
          }
          const article = element("article", "public-study-card");
          const button = element("button", "public-study-open");
          button.type = "button";
          button.setAttribute("aria-label", `${study.title} 크게 보기`);
          button.setAttribute("aria-haspopup", "dialog");
          const visual = image(study);
          const caption = element("span", "public-study-caption");
          caption.append(element("span", "", `Visual study ${String(index + 1).padStart(2, "0")}`), element("span", "", "AI concept image ↗"));
          button.append(visual, caption);
          button.addEventListener("click", () => openStudy(study, button));
          article.append(button); fragment.append(article); cards.set(cardKey, article);
        });
        const focused = document.activeElement;
        grid.replaceChildren(fragment);
        if (focused && grid.contains(focused)) focused.focus({ preventScroll: true });
        more.hidden = count >= collection.records.length && collection.nextOffset === null;
        more.disabled = inFlight;
      };
      const fetchPage = async offset => {
        const abort = typeof window.AbortController === "function" ? new window.AbortController() : null;
        const timeout = window.setTimeout(() => abort?.abort(), 7000);
        try {
          const response = await window.fetch(`/api/v1/studies?limit=${PAGE_SIZE}&offset=${offset}`, { credentials: "same-origin", mode: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, ...(abort ? { signal: abort.signal } : {}) });
          if (!response.ok) throw new Error("STUDY_PAGE_UNAVAILABLE");
          return await response.json();
        } finally { window.clearTimeout(timeout); }
      };
      const refresh = async (force = false) => {
        if (inFlight || Date.now() - lastRequestedAt < (force ? 1000 : 30000)) return;
        inFlight = true; lastRequestedAt = Date.now(); more.disabled = true;
        try {
          const updated = mergePage(collection, await fetchPage(0), window.location.origin, true);
          if (updated) {
            const added = updated.records.some(study => !collection.records.some(previous => previous.id === study.id));
            collection = updated;
            if (added) status.textContent = "새로운 AI 이미지가 포트폴리오에 추가되었습니다.";
          }
        } catch (_) {
          // The selected editorial studies remain available when the public feed is offline.
        } finally { inFlight = false; render(); }
      };
      more.addEventListener("click", async () => {
        if (inFlight) return;
        const target = count + PAGE_SIZE;
        inFlight = true; more.disabled = true;
        let failed = false;
        try {
          // Overlapping offset pages are possible while other visitors publish. Dedupe and keep going.
          for (let attempts = 0; collection.records.length < target && collection.nextOffset !== null && attempts < 4; attempts++) {
            const offset = collection.nextOffset;
            const updated = mergePage(collection, await fetchPage(offset), window.location.origin);
            if (!updated || updated.nextOffset === offset) throw new Error("STUDY_PAGE_INVALID");
            collection = updated;
          }
          count = Math.min(target, collection.records.length);
        } catch (_) { failed = true; }
        finally {
          inFlight = false; render();
          if (failed) status.textContent = "이미지를 더 불러오지 못했습니다. 다시 눌러주세요.";
        }
      });
      if (window.FORMEQUA_DEPLOYMENT?.remoteStudiesEnabled === false) {
        // Keep the static reference image and its dialog, without requesting
        // or polling a server collection on stateless deployments.
        more.hidden = true;
        revealAnchor();
        render();
        return;
      }
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(true); });
      window.addEventListener("pageshow", () => refresh(true));
      window.addEventListener("storage", event => { if (event.key === "formequa:studies:updated") refresh(true); });
      window.addEventListener("atelier:study-published", () => refresh(true));
      window.addEventListener("hashchange", () => { if (isPortfolioHash()) { revealAnchor(); refresh(true); } });
      if (typeof window.setInterval === "function") window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 45000);
      revealAnchor();
      refresh();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
  }
  return Object.freeze({ normalizeStudy, mergePage, mount });
});
