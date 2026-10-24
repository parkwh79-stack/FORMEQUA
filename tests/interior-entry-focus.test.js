"use strict";
// Exercise the real entry detector and public viewer API; replace only geometry
// construction so a GPU is not needed for camera/event regression checks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const navigation = require("../interior-walk.js");

class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  clone() { return new Vector(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  normalize() { return this.multiplyScalar(1 / (Math.hypot(this.x, this.y, this.z) || 1)); }
  multiplyScalar(scale) { return this.set(this.x * scale, this.y * scale, this.z * scale); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
}
class Element {
  constructor() {
    this.listeners = {}; this.hidden = false; this.value = ""; this.dataset = {}; this.textContent = "";
    const classes = new Set();
    this.classList = { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key),
      toggle: (key, on) => { if (on ?? !classes.has(key)) classes.add(key); else classes.delete(key); } };
  }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatchEvent(event) { (this.listeners[event.type] || []).forEach(callback => callback(event)); return true; }
  emit(type, properties = {}) { this.dispatchEvent({ type, target: this, currentTarget: this, ...properties }); }
  setAttribute() {}
  querySelectorAll() { return []; }
  append() {}
  replaceChildren(...children) { this.children = children; }
  focus() { document.activeElement = this; }
  scrollIntoView() {}
}
const nodes = new Map();
const byId = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
const document = new Element();
Object.assign(document, { body: new Element(), getElementById: byId, createElement: () => new Element(),
  querySelector: byId, querySelectorAll: () => [] });
const window = new Element();
window.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
const camera = { position: new Vector(82, 74, 92), fov: 40, aspect: 1.5, lookAt() {}, updateProjectionMatrix() {} };
const controls = { target: new Vector(0, 24, 0), enabled: true, enableDamping: true, dampingFactor: .06, zoomSpeed: 1,
  enablePan: true, minPolarAngle: .1, maxPolarAngle: 2, minDistance: 1, maxDistance: 300, update() {} };
const floor = { level: 4, use: "main", widthM: 20, depthM: 20, northShiftM: 0, zBottom: 12, zTop: 16 };
const model = { floorPlates: [floor], representation: { detailLevel: "concept" }, coreLayout: { status: "generated" } };
const state = { selectedFloorLevel: 4, viewMode: "standard", coreType: "north", option: "A", lastComputed: { model }, parcelKey: "test" };
const plan = { bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, entry: { x: 0, z: 0 },
  rooms: [{ id: 1 }], corridors: [], cores: [], voids: [], walls: [], furniture: [], warnings: [],
  metrics: { roomCount: 1, workstationCount: 0, doorCount: 0 } };
const context = vm.createContext({ window, document, camera, controls, state, console, scene: {},
  renderer: { shadowMap: { autoUpdate: true, needsUpdate: false } },
  AtelierInteriorWalk: navigation, AtelierInteriorPlan: { generate: () => plan },
  THREE: { Vector3: Vector, MathUtils: { degToRad: n => n * Math.PI / 180 } },
  rebuild3DScene() {}, renderFloorInspectorCard() {}, requestAnimationFrame() {} });
let source = fs.readFileSync(path.join(__dirname, "../interior-viewer.js"), "utf8");
source = source.replace(/\}\)\(\);\s*$/, `
  buildStudy = () => { layers = { spaces: { children: [] }, ceilings: { visible: false } }; };
  applyVisibility = () => { byId("interiorControls").hidden = !active; };
  window.testEntry = { detect: detectCameraEntry, reset: () => {
    lastEntryPoint = null; lastDetection = 0; lastAutoRequest = null; zoomEntryUntil = 0;
    model = state.lastComputed.model;
  } };
})();`);
vm.runInContext(source, context, { filename: "interior-viewer.js" });
const changes = [], requests = [];
window.addEventListener("atelier:interior-change", event => changes.push(event.detail));
window.addEventListener("atelier:interior-request", event => requests.push(event.detail));
window.emit("DOMContentLoaded");
const viewer = window.AtelierInteriorViewer, detector = window.testEntry, canvas = byId("threeCanvas");

assert.equal(viewer.open(4, { view: "plan" }), true);
assert.equal(viewer.isActive(), true);
assert.equal(viewer.getState().mode, "plan");
assert.equal(changes.at(-1).plan, plan);
assert.equal(changes.at(-1).level, 4);
assert.equal(changes.at(-1).active, true);
assert.equal(viewer.open(4, { view: "perspective" }), true);
assert.equal(changes.at(-1).mode, "perspective");
assert.equal(viewer.exit(), true);
assert.equal(changes.at(-1).active, false);
assert.equal(viewer.exit(), false, "closing an inactive viewer is a no-op");

model.representation.detailLevel = "massing";
assert.equal(viewer.open(4), false, "the viewer cannot fabricate interior detail from a mass-only model");
document.body.classList.add("model-focus"); detector.reset(); camera.position.set(0, 14, 0);
detector.detect(1000);
assert.equal(requests.length, 1);
assert.equal(requests[0].level, 4); assert.equal(requests[0].origin, "auto"); assert.equal(requests[0].view, "perspective");
assert.equal(viewer.isActive(), false, "the focus controller performs the canonical concept transition");
detector.detect(1200); assert.equal(requests.length, 1, "in-flight concept requests are throttled");
document.body.classList.remove("model-focus"); detector.reset(); detector.detect(1000);
assert.equal(requests.length, 1, "mass-only detail outside focus keeps its existing explicit opt-in");
document.body.classList.add("model-focus"); model.coreLayout.status = "unfeasible"; detector.reset(); detector.detect(1000);
assert.equal(requests.length, 1, "a failed common core cannot be bypassed by zooming");
assert.equal(viewer.open(4), false);
model.coreLayout.status = "generated"; state.viewMode = "exploded"; detector.reset(); detector.detect(1000);
assert.equal(requests.length, 1, "an exploded floor has no automatic exterior entry"); state.viewMode = "standard";

function sweep({ zoom, start = [-20, 14, 0], end = [20, 14, 0], target = [30, 14, 0] }) {
  detector.reset(); controls.target.set(...target); camera.position.set(...start); detector.detect(1000);
  if (zoom) canvas.emit("wheel", { deltaY: -100 });
  camera.position.set(...end); detector.detect(1200);
}
sweep({ zoom: false }); assert.equal(requests.length, 1, "an outside orbit jump cannot trigger swept entry");
sweep({ zoom: true, start: [-20, 14, 11], end: [20, 14, 11], target: [30, 14, 11] });
assert.equal(requests.length, 1, "a zoom passing near the building never enters it");
sweep({ zoom: true }); assert.equal(requests.length, 2, "a fast zoom crossing the actual floor volume is detected");
floor.hasAtrium = true;
sweep({ zoom: true, start: [0, 20, 0], end: [0, 10, 0], target: [0, 0, 0] });
assert.equal(requests.length, 2, "zooming through a courtyard is not a room entry"); floor.hasAtrium = false;
model.representation.detailLevel = "concept"; detector.reset(); camera.position.set(0, 14, 0); detector.detect(1000);
assert.equal(viewer.isActive(), true, "the normal detailed model still enters directly");
assert.equal(changes.at(-1).source, "auto"); assert.equal(changes.at(-1).mode, "perspective"); viewer.exit();

const sixthFloor = { ...floor, level: 6, zBottom: 20, zTop: 24 };
model.floorPlates.push(sixthFloor);
viewer.open(4, { view: "perspective" });
camera.position.set(3, 13.9, 4);
const walkingPosition = camera.position.clone(), oldChangeCount = changes.length;
window.emit("atelier:plan-selected", { detail: { model, floor, plan } });
assert.deepEqual(camera.position, walkingPosition, "refreshing the same floor keeps the visitor's walking position");
assert.equal(changes.length, oldChangeCount, "same-floor drawing refreshes emit no extra interior transition");
window.emit("atelier:plan-selected", { detail: { model: { ...model }, floor: sixthFloor, plan } });
assert.equal(viewer.getState().level, 4, "a stale model's drawing cannot switch the active interior");
let reflectedSelections = 0;
window.addEventListener("atelier:interior-change", event => {
  if (!event.detail.active) return;
  reflectedSelections++;
  window.emit("atelier:plan-selected", { detail: { model, floor: model.floorPlates.find(fp => fp.level === event.detail.level), plan } });
});
window.emit("atelier:plan-selected", { detail: { model, floor: sixthFloor, plan } });
assert.equal(viewer.getState().level, 6, "selecting another valid drawing switches the actual 3D floor");
assert.equal(viewer.getState().mode, "perspective", "changing floors preserves the current interior viewing mode");
assert.equal(viewer.getState().source, "manual");
assert.equal(state.selectedFloorLevel, 6);
assert.equal(reflectedSelections, 1, "selection/interior events cannot recursively reopen the same floor");
window.emit("atelier:plan-selected", { detail: { model, floor: { level: -1 }, plan: null } });
assert.equal(viewer.isActive(), false, "selecting a basement exits the previous unsupported 3D interior");
viewer.open(4);
window.emit("atelier:plan-selected", { detail: { model, floor, plan: null } });
assert.equal(viewer.isActive(), false, "an unavailable drawing must not leave a previous usable interior visible");
viewer.open(4);
window.emit("atelier:plan-selected", { detail: { model, floor: null, plan: null } });
assert.equal(viewer.isActive(), false, "an empty selection exits the old interior");
console.log("Focus interior entry passed: public API/events, canonical mass-detail request, core/view guards, fast inward zoom, courtyard exclusion, selected-floor synchronization and recursion/stale-result guards.");
