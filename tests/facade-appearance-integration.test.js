"use strict";

// Run: node seoul-3d-web/tests/facade-appearance-integration.test.js
// Exercise production functions in an isolated VM. Rendering is replaced only
// at the WebGL boundary so presentation changes cannot hide a financial change.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createWorkspaceBridge = require("../workspace-state.js");
const legal = require("../legal-rules.js");
const root = path.join(__dirname, "..");
const scriptAssets = html => new Set([...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)]
  .map(match => new URL(match[2], "https://local.invalid/"))
  .filter(url => url.origin === "https://local.invalid")
  .map(url => decodeURIComponent(url.pathname.slice(1))));

function fixture(initialClasses = ["dashboard-site"]) {
  const classes = new Set(initialClasses);
  const events = new Map();
  const dispatched = [];
  const styleNodes = [], svgNodes = [];
  const document = {
    body: {
      dataset: {},
      classList: {
        contains: name => classes.has(name),
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle(name, enabled) {
          const selected = enabled === undefined ? !classes.has(name) : enabled;
          if (selected) classes.add(name); else classes.delete(name);
          return selected;
        }
      }
    },
    getElementById: () => null,
    querySelectorAll(selector) {
      if (selector.includes("[style]")) return styleNodes;
      if (selector.includes("svg")) return svgNodes;
      return [];
    }
  };
  const host = {
    AtelierLegal: legal,
    addEventListener(name, listener) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(listener);
    },
    dispatchEvent(event) {
      dispatched.push(event);
      (events.get(event.type) || []).forEach(listener => listener(event));
      return true;
    }
  };
  const context = vm.createContext({
    window: host, document, console,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, "app.js"), "utf8"), context, { filename: "app.js" });
  return { context, classes, events, dispatched, styleNodes, svgNodes, host, document };
}

function read(context, expression) {
  return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

const application = fixture();
const ctx = application.context;
assert.equal(vm.runInContext("typeof getFacadeColorMode", ctx), "function", "the renderer exposes its effective appearance mode");
assert.equal(vm.runInContext("typeof setFacadeColorMode", ctx), "function", "the actual mode control is exercised");
assert.equal(vm.runInContext("state.facadeColorMode", ctx), "atelier", "a study starts in the established atelier palette");

// A saved dashboard choice must never turn the editorial home into a saturated
// preview. Unknown mode values must not escape the same explicit gate.
for (const [page, requested, expected] of [
  ["dashboard-site", "atelier", "atelier"],
  ["dashboard-site", "realistic", "realistic"],
  ["dashboard-site", "invalid", "atelier"],
  ["editorial-site", "realistic", "atelier"],
  ["editorial-site", "atelier", "atelier"]
]) {
  application.classes.clear(); application.classes.add(page);
  ctx.requestedMode = requested;
  assert.equal(vm.runInContext("state.facadeColorMode = requestedMode; getFacadeColorMode()", ctx), expected, `${page} gates ${requested}`);
}
application.classes.clear(); application.classes.add("dashboard-site");

// Verify all five facade systems and six claddings with the real mass/finance
// engine. Appearance is a visual setting, even for materials whose selection
// itself legitimately changes the cost assumptions.
let calculationCount = 0;
const facades = read(ctx, "Object.keys(FACADE_ARCHETYPES)");
const claddings = read(ctx, "Object.keys(CLADDING_MATERIALS)");
assert.equal(facades.length, 5); assert.equal(claddings.length, 6);
for (const facade of facades) {
  for (const cladding of claddings) {
    Object.assign(ctx, { selectedFacade: facade, selectedCladding: cladding });
    vm.runInContext("state.facadeType = selectedFacade; state.claddingMaterial = selectedCladding; state.facadeColorMode = 'atelier'", ctx);
    const before = read(ctx, "evaluateDesignAndProforma(state, state.option)");
    vm.runInContext("state.facadeColorMode = 'realistic'", ctx);
    const after = read(ctx, "evaluateDesignAndProforma(state, state.option)");
    assert.deepEqual(after, before, `the entire calculated model is invariant for ${facade}/${cladding}`);
    calculationCount += 2;
  }
}

const detailBaseline = read(ctx, "evaluateDesignAndProforma(state, state.option)");
let detailCount = 0;
for (const [key, extremes] of Object.entries({
  facadePanelDepthMm: [10, 100], facadeJointMm: [3, 25], facadeLouverAngleDeg: [-60, 60]
})) {
  for (const value of extremes) {
    Object.assign(ctx, { selectedDetailKey: key, selectedDetailValue: value });
    const detailed = read(ctx, "evaluateDesignAndProforma({...state, [selectedDetailKey]: selectedDetailValue}, state.option)");
    assert.deepEqual(detailed, detailBaseline, `${key} at ${value} changes render details without altering the mass, quantities or finance`);
    detailCount++;
  }
}

// Use the actual control, replacing only the WebGL rebuild with a spy. A color
// toggle must reuse the already computed model and must not recalculate it.
vm.runInContext(`
  state.facadeColorMode = 'atelier';
  state.lastComputed = { model: evaluateDesignAndProforma(state, state.option), residual: { marker: 'kept' } };
  var retainedComputation = state.lastComputed;
  var retainedModel = state.lastComputed.model;
  var rebuildModels = [];
  rebuild3DScene = model => rebuildModels.push(model);
  updateAllCalculationsAndUI = () => { throw new Error('a display toggle must not run calculations'); };
`, ctx);
const beforeToggle = read(ctx, "({ inputs: {...state, facadeColorMode: undefined, lastComputed: undefined}, computation: state.lastComputed })");
application.dispatched.length = 0;
vm.runInContext("setFacadeColorMode('realistic')", ctx);
assert.equal(vm.runInContext("getFacadeColorMode()", ctx), "realistic");
assert.equal(vm.runInContext("state.lastComputed === retainedComputation && state.lastComputed.model === retainedModel", ctx), true, "the last calculation keeps its exact object identity");
assert.equal(vm.runInContext("rebuildModels.length", ctx), 1, "one visual rebuild applies a changed mode");
assert.equal(vm.runInContext("rebuildModels[0] === retainedModel", ctx), true, "the existing legal mass is rendered again");
assert.deepEqual(read(ctx, "({ inputs: {...state, facadeColorMode: undefined, lastComputed: undefined}, computation: state.lastComputed })"), beforeToggle, "design inputs, areas, legal decisions and every finance output remain unchanged");
assert.ok(application.dispatched.some(event => event.type === "atelier:appearance"), "appearance consumers receive their dedicated event");
assert.equal(application.dispatched.some(event => event.type === "atelier:updated"), false, "the toggle does not claim a new design calculation");
const appearanceEventCount = application.dispatched.filter(event => event.type === "atelier:appearance").length;
vm.runInContext("setFacadeColorMode('realistic')", ctx);
assert.equal(vm.runInContext("rebuildModels.length", ctx), 1, "selecting the current mode does not rebuild the same WebGL scene");
assert.equal(application.dispatched.filter(event => event.type === "atelier:appearance").length, appearanceEventCount, "an unchanged mode does not issue another appearance change");
vm.runInContext("setFacadeColorMode('invalid')", ctx);
assert.equal(vm.runInContext("state.facadeColorMode", ctx), "atelier", "invalid choices normalize to atelier");

// Cross-page persistence keeps the chosen physical material, but the dashboard
// display preference is not part of the common editable study payload.
const bridge = createWorkspaceBridge({});
const stored = bridge.sanitize(read(ctx, "({...state, facadeColorMode: 'realistic'})"));
assert.equal(stored.claddingMaterial, claddings[claddings.length - 1]);
assert.equal(Object.hasOwn(stored, "facadeColorMode"), false, "the dashboard preview mode is excluded from shared workspace state");
const mainHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const dashboardHtml = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
assert.equal(scriptAssets(mainHtml).has("facade-preview.js"), false, "the editorial home does not load dashboard preview persistence");
assert.equal(scriptAssets(dashboardHtml).has("facade-preview.js"), true, "the detail workspace owns its preview preference");

// Scene teardown must release resources once per object. Cached textures belong
// to the material system, not an individual floor mesh, and survive a rebuild.
function resource(name, extra = {}) {
  return { name, calls: 0, dispose() { this.calls++; }, ...extra };
}
function node(children = [], extra = {}) {
  return {
    children, ...extra,
    remove(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); },
    traverse(visit) { visit(this); this.children.forEach(child => child.traverse(visit)); }
  };
}
const sharedGeometry = resource("shared geometry");
const nestedGeometry = resource("nested geometry");
const ownedTexture = resource("owned label texture", { isTexture: true, userData: {} });
const cachedTexture = resource("cached cladding texture", { isTexture: true, userData: { atelierShared: true } });
const materialA = resource("shared material", { map: cachedTexture, bumpMap: cachedTexture, alphaMap: ownedTexture });
const materialB = resource("second material", { map: ownedTexture });
const group = node([
  node([], { geometry: sharedGeometry, material: materialA }),
  node([node([], { geometry: nestedGeometry, material: [materialA, materialB] })]),
  node([], { geometry: sharedGeometry, material: materialB })
]);
ctx.teardownGroup = group;
vm.runInContext("clearGroup(teardownGroup)", ctx);
assert.equal(group.children.length, 0, "all former scene children are removed");
for (const item of [sharedGeometry, nestedGeometry, materialA, materialB, ownedTexture]) {
  assert.equal(item.calls, 1, `${item.name} is released once despite sharing or nesting`);
}
assert.equal(cachedTexture.calls, 0, "shared procedural maps survive rebuilding floor meshes");

// Run the production dashboard listener against DOM-backed style attributes.
// Financial SVGs keep the established UI palette while true material samples
// preserve their exact values through repeated appearance synchronization.
function attributeNode(attributes, preserve = false) {
  const values = { ...attributes };
  return {
    getAttribute(name) { return values[name] ?? null; },
    setAttribute(name, value) { values[name] = String(value); },
    closest(selector) { return preserve && selector.includes("data-preserve-color") ? this : null; },
    matches(selector) { return preserve && selector.includes("data-preserve-color"); }
  };
}
const ordinaryStyle = attributeNode({ style: "color:#1d4ed8;background:rgba(37,99,235,0.1)" });
const actualChip = attributeNode({ style: "background:#1d4ed8;color:#ffffff" }, true);
const ordinarySvg = attributeNode({ fill: "#3b82f6", stroke: "#10b981" });
const actualSvg = attributeNode({ fill: "#3b82f6", stroke: "#10b981" }, true);
application.styleNodes.push(ordinaryStyle, actualChip);
application.svgNodes.push(ordinarySvg, actualSvg);
vm.runInContext(fs.readFileSync(path.join(root, "dashboard.js"), "utf8"), ctx, { filename: "dashboard.js" });
const originalChipStyle = actualChip.getAttribute("style");
for (let pass = 0; pass < 2; pass++) application.host.dispatchEvent({ type: "atelier:updated" });
assert.equal(actualChip.getAttribute("style"), originalChipStyle, "actual-color chips do not undergo the UI tone mapping");
assert.equal(actualSvg.getAttribute("fill"), "#3b82f6");
assert.equal(actualSvg.getAttribute("stroke"), "#10b981");
assert.equal(ordinaryStyle.getAttribute("style").includes("#1d4ed8"), false, "ordinary detail UI remains in the atelier palette");
assert.equal(ordinarySvg.getAttribute("fill"), "#477de0", "financial chart colors retain the requested analysis blue palette");

// Execute the dashboard preview script itself. The DOM fixture has no WebGL
// canvas unless explicitly requested, so storage and mode behavior are tested
// without substituting the production event handlers or persistence logic.
const previewSource = fs.readFileSync(path.join(root, "facade-preview.js"), "utf8");
const previewKey = "seoul-atelier:facade-appearance:v1";
function previewFixture({ page = "dashboard-site", saved = null, readError = false, writeError = false, rendererError = false } = {}) {
  const app = fixture([page]);
  const reads = [], writes = [], listeners = new Map();
  const storage = new Map(saved === null ? [] : [[previewKey, saved]]);
  app.host.sessionStorage = {
    getItem(key) {
      reads.push(key);
      if (readError) throw new Error("storage read unavailable");
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      if (writeError) throw new Error("storage quota unavailable");
      storage.set(key, String(value));
    }
  };
  function element(dataset = {}) {
    return {
      dataset, style: { setProperty(name, value) { this[name] = value; } }, hidden: false, attributes: {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
      addEventListener(name, callback) { listeners.set(this, { ...(listeners.get(this) || {}), [name]: callback }); }
    };
  }
  const toggle = element(), accentGroup = element(), glassGroup = element();
  const quickAccent = element({ qaccent: "terracotta" }), quickGlass = element({ qglass: "sapphire_blue" });
  const fallback = element(); fallback.hidden = true;
  const nodes = new Map([
    ["exteriorColorSwatchGroup", accentGroup], ["glassTintSwatchGroup", glassGroup],
    ["facadeSampleName", element()], ["facadeSampleDescription", element()],
    ["facadeMaterialFallback", fallback]
  ]);
  const canvas = element();
  if (rendererError) {
    const study = element(); study.open = true;
    study.closest = () => ({ classList: { contains: name => name === "open" } });
    nodes.set("facadeMaterialStudy", study); nodes.set("facadeMaterialCanvas", canvas);
    const three = { WebGLRenderer: class { constructor() { throw new Error("WebGL unavailable"); } } };
    app.host.THREE = three; app.context.THREE = three;
  }
  app.document.getElementById = id => nodes.get(id) || null;
  app.document.querySelectorAll = selector => {
    if (selector === "[data-facade-color-toggle]") return [toggle];
    if (selector === "[data-qaccent],[data-qglass]") return [quickAccent, quickGlass];
    if (selector === "[data-accent],[data-qaccent]") return [quickAccent];
    if (selector === "[data-glasstint],[data-qglass]") return [quickGlass];
    return [];
  };
  app.document.addEventListener = () => {};
  app.host.AtelierMaterials = {
    resolveAppearance: () => ({ nameKr: "테라코타", descriptionKr: "표면 검토", spandrelHex: 0xb5724b, glassHex: 0x5b8595 })
  };
  app.context.AtelierMaterials = app.host.AtelierMaterials;
  vm.runInContext("rebuild3DScene = () => {};", app.context);
  vm.runInContext(previewSource, app.context, { filename: "facade-preview.js" });
  return {
    ...app, reads, writes, storage, toggle, accentGroup, glassGroup, quickAccent, quickGlass, canvas, fallback,
    initialize() { app.events.get("DOMContentLoaded").at(-1)(); },
    click() { listeners.get(toggle).click(); }
  };
}

const restoredPreview = previewFixture({ saved: "realistic" });
assert.deepEqual(restoredPreview.reads, [previewKey], "the dashboard reads its separate appearance key");
assert.equal(vm.runInContext("state.facadeColorMode", restoredPreview.context), "realistic", "the saved mode is restored before the first main-scene calculation");
assert.equal(restoredPreview.writes.length, 0, "loading a preference does not overwrite it");
restoredPreview.initialize();
assert.equal(restoredPreview.toggle.attributes["aria-pressed"], "true");
assert.equal(restoredPreview.toggle.disabled, false, "the mode control is usable when materials are available");
for (const sample of [restoredPreview.accentGroup, restoredPreview.glassGroup, restoredPreview.quickAccent, restoredPreview.quickGlass]) {
  assert.equal(Object.hasOwn(sample.dataset, "preserveColor"), true, "all actual color sample groups are protected before dashboard retone");
}
restoredPreview.click();
assert.equal(vm.runInContext("state.facadeColorMode", restoredPreview.context), "atelier");
assert.deepEqual(restoredPreview.writes.at(-1), [previewKey, "atelier"], "the actual toggle stores its appearance event using only the separate key");
restoredPreview.click();
assert.deepEqual(restoredPreview.writes.at(-1), [previewKey, "realistic"]);
assert.equal(restoredPreview.writes.every(([key]) => key === previewKey), true, "display choices never replace the shared study payload");

for (const saved of [null, "", "invalid", '"realistic"', "REALISTIC", "atelier"]) {
  const preview = previewFixture({ saved });
  assert.equal(vm.runInContext("state.facadeColorMode", preview.context), "atelier", `unsupported saved appearance ${JSON.stringify(saved)} falls back to atelier`);
}
const blockedPreview = previewFixture({ readError: true, writeError: true });
assert.equal(vm.runInContext("state.facadeColorMode", blockedPreview.context), "atelier", "storage read errors keep the established palette");
assert.doesNotThrow(() => { blockedPreview.initialize(); blockedPreview.click(); }, "write rejection does not break the color control or the calculations");
assert.equal(vm.runInContext("getFacadeColorMode()", blockedPreview.context), "realistic", "a local color preview still works without writable storage");

const protectedHome = previewFixture({ page: "editorial-site", saved: "realistic" });
assert.equal(protectedHome.reads.length, 0, "the script guard never reads dashboard preferences on the editorial page");
assert.equal(protectedHome.writes.length, 0);
assert.equal(protectedHome.events.has("atelier:appearance"), false, "a mistakenly included dashboard script does not install home listeners");
assert.equal(vm.runInContext("state.facadeColorMode", protectedHome.context), "atelier");

const failedRenderer = previewFixture({ rendererError: true });
assert.doesNotThrow(() => failedRenderer.initialize(), "a failed supplementary WebGL canvas does not interrupt the workspace");
assert.equal(failedRenderer.canvas.hidden, true, "the failed material canvas is hidden");
assert.equal(failedRenderer.fallback.hidden, false, "the material sample exposes its fallback");

console.log(`Facade appearance: ${calculationCount} real-engine material/mode combinations and ${detailCount} physical-detail boundaries preserve all computed results; dashboard gate, visual-only toggle, workspace/session isolation, storage/WebGL fallback, shared-resource cleanup and true-color chip preservation passed.`);
