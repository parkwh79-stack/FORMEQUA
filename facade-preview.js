/** Dashboard-only material inspection. Shared geometry/calculations stay in app.js. */
(() => {
  "use strict";
  if (!document.body.classList.contains("dashboard-site")) return;
  const STORAGE_KEY = "seoul-atelier:facade-appearance:v1";
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    state.facadeColorMode = saved === "realistic" ? "realistic" : "atelier";
  } catch (_) { state.facadeColorMode = "atelier"; }

  // Protect the actual material samples from the dashboard's UI palette pass.
  ["exteriorColorSwatchGroup", "glassTintSwatchGroup"].forEach(id => {
    const node = document.getElementById(id);
    if (node) node.dataset.preserveColor = "";
  });
  document.querySelectorAll("[data-qaccent],[data-qglass]").forEach(node => { node.dataset.preserveColor = ""; });

  const byId = id => document.getElementById(id);
  const study = byId("facadeMaterialStudy"), canvas = byId("facadeMaterialCanvas");
  let sampleRenderer = null, sampleScene = null, sampleCamera = null, sampleControls = null;
  let sampleGroup = null, environment = null, observer = null;
  let inView = false, frame = 0, signature = "", failed = false;
  const hex = value => "#" + value.toString(16).padStart(6, "0");

  function syncSwatches() {
    if (!window.AtelierMaterials) return;
    const options = { materialKey: state.claddingMaterial, mode: getFacadeColorMode(),
      facadeType: state.facadeType, isDay: true, accentKey: state.facadeAccent, glassTintKey: state.glassTint };
    document.querySelectorAll("[data-accent],[data-qaccent]").forEach(button => {
      const key = button.dataset.accent || button.dataset.qaccent;
      if (key === "auto") {
        const tones = ["titanium", "champagne", "terracotta", "sapphire"].map(accentKey =>
          hex(AtelierMaterials.resolveAppearance({ ...options, accentKey }).spandrelHex));
        button.style.background = "conic-gradient(" + tones.join(",") + ")";
      } else {
        button.style.background = hex(AtelierMaterials.resolveAppearance({ ...options, accentKey: key }).spandrelHex);
      }
    });
    document.querySelectorAll("[data-glasstint],[data-qglass]").forEach(button => {
      const key = button.dataset.glasstint || button.dataset.qglass;
      const colour = AtelierMaterials.resolveAppearance({ ...options, glassTintKey: key }).glassHex;
      button.style.background = hex(colour);
      const luminance = ((colour >> 16 & 255) * .2126 + (colour >> 8 & 255) * .7152 + (colour & 255) * .0722) / 255;
      button.style.color = luminance > .58 ? "#242622" : "#faf9f5";
      button.style.setProperty("--swatch-ink", luminance > .58 ? "#242622" : "#faf9f5");
    });
  }

  function visible() {
    return study?.open && study.closest(".atelier-chapter")?.classList.contains("open")
      && document.visibilityState !== "hidden" && inView && !failed;
  }

  function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; }

  function renderFrame() {
    frame = 0;
    if (!visible() || !sampleRenderer) return;
    sampleControls.update();
    sampleRenderer.render(sampleScene, sampleCamera);
    frame = requestAnimationFrame(renderFrame);
  }

  function resize() {
    if (!sampleRenderer || !canvas.clientWidth || !canvas.clientHeight) return;
    sampleRenderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    sampleCamera.aspect = canvas.clientWidth / canvas.clientHeight;
    sampleCamera.updateProjectionMatrix();
  }

  function initialize() {
    if (sampleRenderer || failed || !window.THREE || !window.AtelierMaterials) return;
    try {
      sampleRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
      sampleRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      sampleRenderer.outputEncoding = THREE.sRGBEncoding;
      sampleRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      sampleRenderer.toneMappingExposure = .92;
      sampleRenderer.shadowMap.enabled = true;
      sampleRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      sampleScene = new THREE.Scene();
      sampleScene.background = new THREE.Color(0xe9e6dd);
      sampleCamera = new THREE.PerspectiveCamera(36, 1, .05, 100);
      sampleCamera.position.set(6.9, 4.6, 8.4);
      sampleControls = new THREE.OrbitControls(sampleCamera, canvas);
      sampleControls.target.set(0, 1.55, 0);
      sampleControls.enableDamping = true;
      sampleControls.enablePan = false;
      sampleControls.enableZoom = false;
      sampleControls.minPolarAngle = .45; sampleControls.maxPolarAngle = 1.6;
      sampleControls.update();
      sampleScene.add(new THREE.HemisphereLight(0xfffbf3, 0xa8a08f, .9));
      const key = new THREE.DirectionalLight(0xfff8eb, 1.15);
      key.position.set(-4, 7, 6); key.castShadow = true;
      key.shadow.mapSize.set(512, 512); key.shadow.bias = -.0002;
      sampleScene.add(key);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0xe2ddd1, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -.04; floor.receiveShadow = true;
      sampleScene.add(floor);
      sampleGroup = new THREE.Group(); sampleScene.add(sampleGroup);
      environment = AtelierMaterials.createEnvironmentMap(THREE, sampleRenderer);
      resize();
    } catch (_) {
      failed = true; stop();
      sampleRenderer?.dispose(); sampleRenderer = null;
      canvas.hidden = true;
      if (byId("facadeMaterialFallback")) byId("facadeMaterialFallback").hidden = false;
    }
  }

  function updateSample() {
    const appearance = getFacadeAppearance();
    if (!appearance) return;
    if (byId("facadeSampleName")) byId("facadeSampleName").textContent = appearance.nameKr;
    if (byId("facadeSampleDescription")) byId("facadeSampleDescription").textContent = appearance.descriptionKr;
    if (!visible()) return;
    initialize();
    if (!sampleRenderer) return;
    const next = JSON.stringify([state.claddingMaterial, getFacadeColorMode(), state.facadeAccent,
      state.facadeType, state.facadePanelDepthMm, state.facadeJointMm, state.facadeLouverM, state.facadeLouverAngleDeg]);
    if (signature !== next) {
      clearGroup(sampleGroup);
      const material = AtelierMaterials.createCladdingMaterial(THREE, {
        materialKey: state.claddingMaterial, mode: getFacadeColorMode(), baseHex: appearance.spandrelHex,
        widthM: 1, heightM: 1, jointMm: state.facadeJointMm, envMap: environment.texture, envMapIntensity: .9
      });
      const layout = AtelierFacadeGeometry.generatePanelBand({
        widthM: 4.8, depthM: 1.7, heightM: 3.2, yCenterM: 1.6,
        thicknessMm: state.facadePanelDepthMm, jointMm: state.facadeJointMm, moduleWidthM: appearance.tileWidthM
      });
      addFacadePanelMeshes(sampleGroup, layout.panels, material);
      if (state.facadeType === "kinetic_louver") {
        const colour = getFacadeColorMode() === "realistic" ? new THREE.Color(appearance.frameHex).convertSRGBToLinear() : appearance.frameHex;
        const fins = new THREE.MeshStandardMaterial({ color: colour, metalness: .72, roughness: .34, envMap: environment.texture });
        const geometry = new THREE.BoxGeometry(.07, 3.2, Math.max(.12, state.facadeLouverM));
        for (let i = 0; i <= 8; i++) {
          const fin = new THREE.Mesh(geometry, fins);
          fin.position.set(-2.4 + i * .6, 1.6, .85 + state.facadeLouverM / 2);
          fin.rotation.y = AtelierFacadeGeometry.louverAngleRadians(state.facadeLouverAngleDeg);
          fin.castShadow = true; sampleGroup.add(fin);
        }
      }
      signature = next;
    }
    resize();
    if (!frame) frame = requestAnimationFrame(renderFrame);
  }

  function refresh() {
    syncFacadeColorUI(); syncSwatches(); updateSample();
    if (!visible()) stop();
  }
  window.addEventListener("atelier:updated", refresh);
  window.addEventListener("atelier:appearance", () => {
    try { window.sessionStorage.setItem(STORAGE_KEY, state.facadeColorMode); } catch (_) {}
    refresh();
  });
  window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-facade-color-toggle]").forEach(button => {
      button.addEventListener("click", () => setFacadeColorMode(getFacadeColorMode() === "realistic" ? "atelier" : "realistic"));
    });
    study?.addEventListener("toggle", refresh);
    canvas?.addEventListener("webglcontextlost", event => {
      event.preventDefault(); failed = true; stop();
      byId("facadeMaterialFallback").hidden = false;
    });
    canvas?.addEventListener("webglcontextrestored", () => {
      failed = false; signature = "";
      environment?.dispose();
      if (sampleRenderer) environment = AtelierMaterials.createEnvironmentMap(THREE, sampleRenderer);
      byId("facadeMaterialFallback").hidden = true; refresh();
    });
    if (canvas && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(entries => {
        inView = entries.some(entry => entry.isIntersecting); refresh();
      });
      observer.observe(canvas);
    } else inView = true;
    if (canvas && "ResizeObserver" in window) new ResizeObserver(() => { resize(); refresh(); }).observe(canvas);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("resize", resize);
    refresh();
  });
  window.addEventListener("pageshow", event => { if (event.persisted) refresh(); });
  window.addEventListener("pagehide", event => {
    stop();
    if (!event.persisted) {
      observer?.disconnect();
      if (sampleGroup) clearGroup(sampleGroup);
      environment?.dispose(); sampleControls?.dispose(); sampleRenderer?.dispose();
    }
  });
})();
