/** Presentation layer for the FORMEQUA architectural journal. */
(() => {
  "use strict";

  const studies = {
    gangnam_yeoksam: { title: "Yeoksam — Office study", district: "서울특별시 강남구" },
    seongdong_seongsu: { title: "Seongsu — Creative workplace", district: "서울특별시 성동구" },
    mapo_hapjeong: { title: "Hapjeong — Living study", district: "서울특별시 마포구" },
    jongno_euljiro: { title: "Euljiro — Renewal study", district: "서울특별시 중구" },
    custom_seoul: { title: "A new possibility — Your site", district: "서울특별시" }
  };
  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const el = byId(id); if (el) el.textContent = value; };
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const contactUrl = "https://wan2-website.web.app/#contact";

  function openDashboard(context, view = "model") {
    if (view === "workspace") {
      window.location.assign(contactUrl);
      return;
    }
    const workspace = window.AtelierWorkspace;
    workspace?.save();
    const path = "model.html";
    const target = new URL(path, window.location.href);
    Object.entries(context).forEach(([key, value]) => { if (value) target.searchParams.set(key, value); });
    window.location.assign(workspace ? workspace.buildUrl(path, context) : target.href);
  }

  function openDesign(chapter = "chap-mass", view = "model") {
    openDashboard({ chapter, returnTo: "#studio" }, view);
  }

  function openAnalysis(tabId = "tab-area", disclosureId) {
    openDashboard({ tab: tabId, drawer: disclosureId, returnTo: "#feasibility" }, "workspace");
  }

  function showLocalSection(sectionId, disclosureId) {
    const disclosure = byId(disclosureId);
    if (disclosure) disclosure.open = true;
    if (window.FormequaNavigation) window.FormequaNavigation.go(`#${sectionId}`);
    else byId(sectionId)?.scrollIntoView({ behavior: reduceMotion() ? "instant" : "smooth", block: "start" });
  }

  function syncEditorial(detail) {
    if (!detail?.model) return;
    const model = detail.model;
    const key = detail.parcelKey;
    const study = studies[key] || studies.custom_seoul;
    const preset = typeof SEOUL_PARCELS !== "undefined" ? SEOUL_PARCELS[key] : null;
    const current = typeof state !== "undefined" ? state : {};
    const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString("ko-KR") : "—";
    setText("editorialProjectName", study.title);
    setText("editorialSiteName", model.parcelGeometry ? (model.parcelGeometry.addresses.join(" + ") || "적용 필지 경계") : preset?.name || "새로운 대지");
    setText("editorialSiteDistrict", model.parcelGeometry ? "경계 자료 적용 · 행정 조건 확인 전" : study.district);
    setText("editorialSiteArea", `${number(model.zoningRule.cadastralAreaSqm)} ㎡`);
    setText("editorialSiteZone", current.zoning || preset?.zoning || "—");
    setText("editorialSiteRoad", `${number(current.roadWidthM)} m`);
    setText("editorialSitePlan", model.parcelGeometry ? "지구단위계획 확인 전" : preset?.districtPlan || "대상지 검토");
    setText("editorialLegalDensity", `현재 모형의 검토 상한 · 건폐율 ${number(model.zoningRule.maxBcr)}% · 용적률 ${number(model.zoningRule.maxFar)}%. ${model.regulationMode === "scenario" ? "사용자가 추가한 비교 조건을 포함합니다." : "입력된 용도지역의 일반 기준을 참고합니다."}`);
    setText("editorialMaterialName", model.facade.claddingNameKr || model.facade.claddingShortKr || "");
    setText("editorialModelCaption", `${number(model.actualFloorsAbove)} FLOORS / B${number(current.floorsBelow)} · OPTION ${current.option || "A"}`);
    document.querySelectorAll("[data-select-option]").forEach(button => {
      const selected = button.dataset.selectOption === current.option;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("[data-parcel]").forEach(button => button.classList.toggle("is-selected", button.dataset.parcel === key));
  }

  // Register before app.js initializes so the first computed model is visible.
  window.addEventListener("atelier:updated", event => syncEditorial(event.detail));
  // Embedded controls stay inside the journal. Only explicit detail CTAs open the workbench.
  window.addEventListener("atelier:open-design", event => showLocalSection(event.detail?.chapterId === "chap-site" ? "site" : "studio", event.detail?.chapterId === "chap-site" ? "atelierSiteNote" : null));
  window.addEventListener("atelier:open-analysis", event => showLocalSection(event.detail?.tabId === "tab-finance" ? "feasibility" : "site", event.detail?.tabId === "tab-smap-law" ? "atelierLawNote" : null));
  window.addEventListener("atelier:viewer-unavailable", () => {
    const fallback = byId("viewerFallback");
    if (fallback) fallback.hidden = false;
  });

  window.addEventListener("DOMContentLoaded", () => {
    // Keep the model presentation quiet until the visitor requests dimensions.
    if (typeof state !== "undefined") {
      state.showDimensions = false;
      const check = byId("chkShowDimensions");
      if (check) check.checked = false;
    }

    document.querySelectorAll("[data-open-design]").forEach(button => button.addEventListener("click", () => openDesign(button.dataset.openDesign, button.dataset.workspaceView)));
    document.querySelectorAll("[data-open-analysis]").forEach(button => button.addEventListener("click", () => openAnalysis(button.dataset.openAnalysis)));
    document.querySelectorAll("[data-parcel]").forEach(button => button.addEventListener("click", () => {
      const select = byId("parcelSelect");
      if (!select) return;
      select.value = button.dataset.parcel;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      byId("atelierAnnouncement").textContent = `${byId("editorialProjectName")?.textContent || studies[button.dataset.parcel]?.title || "선택한 대지"} 설계 연구를 열었습니다.`;
      if (window.FormequaNavigation) window.FormequaNavigation.go("#studio");
      else byId("studio").scrollIntoView({ behavior: reduceMotion() ? "instant" : "smooth", block: "start" });
    }));

    document.querySelectorAll("[data-select-option]").forEach(button => button.addEventListener("click", () => {
      document.querySelector(`.option-card[data-option="${button.dataset.selectOption}"]`)?.click();
    }));

    const metricLabels = ["용적률 산정 연면적", "임대 전용면적", "총사업비", "최대 자기자본", "자기자본 수익률", "토지매입한도"];
    document.querySelectorAll(".quiet-metrics .kpi-cell").forEach((cell, index) => {
      const label = cell.querySelector(".kpi-label > span");
      if (label) label.textContent = metricLabels[index];
      cell.removeAttribute("title");
      cell.removeAttribute("data-kpitab");
      cell.removeAttribute("data-kpidrawer");
    });

    // Lazy-load the external map only when it is requested.
    byId("btnToggleSmap")?.addEventListener("click", () => {
      const frame = byId("smapIframe");
      if (frame?.dataset.src && frame.getAttribute("src") === "about:blank") frame.src = frame.dataset.src;
      byId("studio").scrollIntoView({ behavior: reduceMotion() ? "instant" : "smooth", block: "start" });
    });
    byId("btnRecordVideo")?.addEventListener("click", () => {
      byId("studio").scrollIntoView({ behavior: reduceMotion() ? "instant" : "smooth", block: "start" });
    });

    if ("IntersectionObserver" in window) {
      const revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) { entry.target.classList.add("is-visible"); revealObserver.unobserve(entry.target); }
        });
      }, { rootMargin: "0px 0px -35px 0px", threshold: 0.08 });
      document.querySelectorAll(".reveal").forEach(el => revealObserver.observe(el));
      const revealPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
      const syncRevealPreference = () => document.body.classList.toggle("motion-ready", !revealPreference.matches);
      syncRevealPreference();
      revealPreference.addEventListener("change", syncRevealPreference);

    }

    if (typeof state !== "undefined" && state.lastComputed) syncEditorial({ ...state.lastComputed, parcelKey: state.parcelKey });
    if (document.body.dataset.viewerUnavailable === "true") byId("viewerFallback").hidden = false;
  });
})();
