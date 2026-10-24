"use strict";
// Exercise actual viewer event handlers and camera transitions without a GPU.
// Geometry presentation is replaced; the movement, input and restore code is not.
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
}
class Element {
  constructor() { this.listeners = {}; this.dataset = {}; this.hidden = false; this.value = ""; this.textContent = ""; this.attributes = {}; this.captures = new Set(); this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  emit(type, detail = {}) { const event = { currentTarget: this, target: this, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...detail }; (this.listeners[type] || []).forEach(callback => callback(event)); return event; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelectorAll() { return directionButtons; }
  append() {}
  focus() { if (document.activeElement !== this) document.activeElement?.emit("blur"); document.activeElement = this; }
  hasPointerCapture(id) { return this.captures.has(id); }
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.emit("lostpointercapture", { pointerId: id }); }
  scrollIntoView() {}
}
const nodes = new Map();
const byId = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
const directionButtons = ["w", "a", "s", "d"].map(key => { const node = new Element(); node.dataset.walkDirection = key; return node; });
const document = new Element();
Object.assign(document, { getElementById: byId, createElement: () => new Element(), body: new Element(), hidden: false,
  querySelector: selector => byId(selector),
  querySelectorAll: selector => selector === "[data-walk-direction]" ? directionButtons : [] });
const window = new Element();
const camera = { position: new Vector(82, 74, 92), fov: 40, aspect: 1.5, lookAt() {}, updateProjectionMatrix() {} };
const controls = { target: new Vector(0, 24, 0), enabled: true, enableDamping: true, dampingFactor: .06, zoomSpeed: 1,
  enablePan: true, minPolarAngle: .1, maxPolarAngle: 2, minDistance: 1, maxDistance: 300, update() {} };
const shadowMap = { autoUpdate: true, needsUpdate: false };
const floor = { level: 4, use: "main", widthM: 20, depthM: 20, zBottom: 12, zTop: 16 };
const model = { floorPlates: [floor] };
const plan = { bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, entry: { x: 0, z: 0 },
  rooms: [{ id: 1 }], corridors: [], cores: [], voids: [], walls: [], furniture: [], warnings: [],
  metrics: { roomCount: 1, workstationCount: 0, doorCount: 0 } };
const context = vm.createContext({ window, document, console, camera, controls, scene: {}, renderer: { shadowMap },
  state: { selectedFloorLevel: 4, coreType: "north", option: "A", lastComputed: { model }, parcelKey: "test" },
  AtelierInteriorWalk: navigation, AtelierInteriorPlan: { generate: () => plan },
  THREE: { Vector3: Vector, MathUtils: { degToRad: deg => deg * Math.PI / 180 } },
  rebuild3DScene() {}, renderFloorInspectorCard() {}, requestAnimationFrame() {} });
let source = fs.readFileSync(path.join(__dirname, "../interior-viewer.js"), "utf8");
source = source.replace(/\}\)\(\);\s*$/, `
  buildStudy = () => { layers = { spaces: { children: [] }, ceilings: { visible: false } }; };
  applyVisibility = () => { byId("interiorControls").hidden = !active; };
  updateModel = () => {};
  window.testViewer = { open: () => { model = state.lastComputed.model; openInterior(4, "manual", "perspective"); },
    setView, exitInterior, frame, snapshot: () => ({ active, mode, keyCount: keys.size, drag: walk.drag, held: heldDirections.size }) };
})();`);
vm.runInContext(source, context, { filename: "interior-viewer.js" });
window.emit("DOMContentLoaded");
const viewer = window.testViewer, canvas = byId("threeCanvas");
const originalPosition = camera.position.clone(), originalTarget = controls.target.clone();
viewer.open();
assert.equal(controls.enabled, false, "perspective disables OrbitControls");
assert.equal(controls.enableDamping, false, "first-person look does not inherit orbit damping");
assert.equal(shadowMap.autoUpdate, false, "walking reuses a static shadow map");
assert.equal(byId("interiorFootwork").hidden, false, "walking controls are visible in perspective");
const beforeLook = camera.position.clone();
canvas.emit("pointerdown", { pointerId: 7, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
canvas.emit("pointermove", { pointerId: 7, clientX: 200, clientY: 115 });
assert.equal(camera.position.x, beforeLook.x); assert.equal(camera.position.z, beforeLook.z, "looking rotates in place");
assert.notEqual(controls.target.z, beforeLook.z, "camera heading changes immediately");
assert.ok(canvas.captures.has(7), "drag captures the pointer");
canvas.emit("pointerup", { pointerId: 7 });
assert.equal(canvas.captures.size, 0);
const beforeWheel = camera.position.clone();
const wheelEvent = canvas.emit("wheel", { deltaY: -100, deltaMode: 0 });
assert.equal(wheelEvent.prevented, true, "the perspective canvas consumes its own wheel input");
assert.ok(Math.hypot(camera.position.x - beforeWheel.x, camera.position.z - beforeWheel.z) > 1.19, "wheel advances camera along its current heading");
assert.ok(byId("interiorWalkDistance").textContent.includes("1.2 m"));

document.emit("keydown", { key: "w" });
viewer.frame(1000); viewer.frame(1020);
const afterKey = camera.position.clone();
assert.ok(viewer.snapshot().keyCount > 0);
byId("interiorWalkSpeed").focus();
viewer.frame(1040);
assert.equal(viewer.snapshot().keyCount, 0, "leaving the canvas clears held keys");
assert.equal(camera.position.x, afterKey.x, "a form control cannot leave walking stuck on");
document.emit("keydown", { key: "w" });
assert.equal(viewer.snapshot().keyCount, 0, "typing in form controls never walks");
canvas.focus();
document.emit("keydown", { key: "w" }); document.hidden = true; document.emit("visibilitychange");
assert.equal(viewer.snapshot().keyCount, 0, "backgrounding clears held movement"); document.hidden = false;
directionButtons[0].emit("pointerdown", { pointerId: 8, pointerType: "mouse", button: 0 });
assert.equal(viewer.snapshot().held, 1);
window.emit("blur");
assert.equal(viewer.snapshot().held, 0, "window blur releases directional walking");
assert.equal(directionButtons[0].captures.size, 0, "window blur releases button pointer capture");
canvas.emit("pointerdown", { pointerId: 9, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
viewer.setView("plan");
assert.equal(canvas.captures.size, 0, "mode changes release look capture");
assert.equal(controls.enabled, true); assert.equal(controls.zoomSpeed, 1.9); assert.equal(controls.dampingFactor, .2);
assert.equal(byId("interiorFootwork").hidden, true);
const ignoredWheel = canvas.emit("wheel", { deltaY: -100 });
assert.ok(!ignoredWheel.prevented, "normal plan/orbit wheel remains with OrbitControls");
viewer.exitInterior();
assert.deepEqual(camera.position, originalPosition); assert.deepEqual(controls.target, originalTarget);
assert.equal(controls.enabled, true); assert.equal(controls.enableDamping, true);
assert.equal(controls.zoomSpeed, 1); assert.equal(controls.dampingFactor, .06);
assert.equal(shadowMap.autoUpdate, true, "exterior rendering restores its original shadow policy");
console.log("Interior walk lifecycle passed: immediate look/wheel, focus and visibility cleanup, pointer release, mode changes, and exterior restore.");
