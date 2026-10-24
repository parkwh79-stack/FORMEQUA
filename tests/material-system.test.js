"use strict";

// Run: node seoul-3d-web/tests/material-system.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const materials = require("../material-system.js");
const keys = ["anodized_metal", "terracotta_brick", "limestone", "granite_pocheon", "uhpc_concrete", "champagne_bronze"];
assert.deepEqual(Object.keys(materials.definitions), keys);

// Accepted atelier colours must survive adding a reference-colour toggle.
const atelierAccents = {
  titanium: [0xebe8df, 0xdedacf, 0xf1ede4], warm_limestone: [0xb9ad99, 0xcbbda6, 0xe4dccf],
  champagne: [0x9a8566, 0xb4a084, 0xd0c1ab], terracotta: [0x654d40, 0xa57961, 0xd7c7b6],
  crimson_brick: [0x443c35, 0x875f50, 0xc9bba9], sage_patina: [0x68745e, 0x8b957b, 0xc8cbb7],
  sapphire: [0x9da6a0, 0x667981, 0xd0d2c8], basalt_charcoal: [0x494c44, 0x676b60, 0xa6aa9c]
};
for (const [accentKey, expected] of Object.entries(atelierAccents)) {
  const appearance = materials.resolveAppearance({ mode: "atelier", accentKey });
  assert.deepEqual([appearance.frameHex, appearance.spandrelHex, appearance.slabHex], expected);
}
const baseAtelier = materials.resolveAppearance({ materialKey: "anodized_metal", facadeType: "curtain_wall" });
assert.equal(baseAtelier.frameHex, 0x8d8576);
assert.equal(baseAtelier.spandrelHex, 0xc6bfb1);
assert.equal(baseAtelier.glassHex, 0x909d97);
assert.equal(materials.resolveAppearance({ materialKey: "not-a-material", mode: "invalid" }).key, "anodized_metal");
assert.equal(materials.resolveAppearance({ mode: "invalid" }).mode, "atelier");

for (const key of keys) {
  const definition = materials.getDefinition(key);
  assert.ok(definition.tileWidthM > 0 && definition.tileHeightM > 0);
  assert.ok(definition.roughness >= 0 && definition.roughness <= 1);
  const first = materials.generateTexturePixels({ materialKey: key, mode: "realistic", size: 64, seed: 4 });
  const repeat = materials.generateTexturePixels({ materialKey: key, mode: "realistic", size: 64, seed: 4 });
  const reseeded = materials.generateTexturePixels({ materialKey: key, mode: "realistic", size: 64, seed: 5 });
  const atelier = materials.generateTexturePixels({ materialKey: key, mode: "atelier", size: 64, seed: 4 });
  assert.deepEqual(first.albedo, repeat.albedo, key + " should be stable");
  assert.notDeepEqual(first.albedo, reseeded.albedo, key + " should respond to seed");
  assert.notDeepEqual(first.albedo, atelier.albedo, key + " should respond to colour mode");
  assert.notDeepEqual(first.albedo, first.bump, key + " colour must not drive relief");
  assert.notDeepEqual(first.bump, first.roughness, key + " roughness must be independently authored");
  // Colour mode changes appearance while retaining the same material geometry.
  assert.deepEqual(first.bump, atelier.bump, key + " colour mode must preserve relief");
  assert.deepEqual(first.roughness, atelier.roughness, key + " colour mode must preserve surface roughness");
  for (let i = 0; i < first.bump.length; i += 4) {
    assert.equal(first.bump[i], first.bump[i + 1]);
    assert.equal(first.bump[i], first.bump[i + 2]);
    assert.equal(first.bump[i + 3], 255);
    assert.equal(first.roughness[i], first.roughness[i + 1]);
  }
  if (!key.includes("metal") && key !== "champagne_bronze") assert.equal(definition.metalness, 0);
  const narrowJoint = materials.generateTexturePixels({ materialKey: key, size: 128, jointMm: 3 });
  const wideJoint = materials.generateTexturePixels({ materialKey: key, size: 128, jointMm: 25 });
  const recessedPixels = data => {
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 90) count++;
    return count;
  };
  assert.ok(recessedPixels(wideJoint.bump) > recessedPixels(narrowJoint.bump), key + " wider joints must have more recessed surface");
}

// Canvas/Three stubs verify contracts without requiring a browser or GPU.
const canvasFactory = () => ({
  width: 0, height: 0,
  getContext() {
    return {
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: image => { this.image = image; }
    };
  }
});
class CanvasTexture {
  constructor(image) { this.image = image; this.userData = {}; this.repeat = { set: (x, y) => { this.repeat.x = x; this.repeat.y = y; } }; this.disposals = 0; }
  dispose() { this.disposals++; }
}
class MeshStandardMaterial { constructor(options) { Object.assign(this, options); this.userData = {}; } }
const THREE = { CanvasTexture, MeshStandardMaterial, RepeatWrapping: 1000, sRGBEncoding: 3001, LinearEncoding: 3000 };
const input = { materialKey: "terracotta_brick", mode: "realistic", widthM: 4.4, heightM: 3, size: 64, canvasFactory };
const maps = materials.getTextureSet(THREE, input);
assert.equal(materials.getTextureSet(THREE, input), maps, "identical requests should reuse shared textures");
const widerJointMaps = materials.getTextureSet(THREE, { ...input, jointMm: 25 });
assert.notEqual(widerJointMaps, maps, "different joint widths must not mutate shared surface maps");
assert.equal(maps.map.encoding, THREE.sRGBEncoding);
assert.equal(maps.bumpMap.encoding, THREE.LinearEncoding);
assert.equal(maps.roughnessMap.encoding, THREE.LinearEncoding);
assert.equal(maps.map.repeat.x, 5);
assert.equal(maps.map.repeat.y, 5);
assert.equal(maps.map.userData.atelierShared, true);
assert.equal(maps.bumpMap.userData.dataRole, "height");
assert.equal(maps.roughnessMap.userData.dataRole, "roughness");
assert.notEqual(maps.map.image, maps.bumpMap.image, "independent canvases prevent colour-space or map aliasing");
const worldUV = materials.getTextureSet(THREE, Object.assign({}, input, { widthM: 1, heightM: 1 }));
assert.equal(worldUV.map.repeat.x, 1 / 0.88);
assert.equal(worldUV.map.repeat.y, 1 / 0.6);
const material = materials.createCladdingMaterial(THREE, input);
assert.equal(material.map, maps.map);
assert.equal(material.bumpMap, maps.bumpMap);
assert.equal(material.roughness, 1, "absolute roughness map must not be multiplied by material roughness twice");
assert.equal(material.metalness, 0);
assert.equal(material.bumpScale, 0.018);
materials.disposeTextureCache(THREE);
assert.equal(maps.map.disposals, 1);
assert.equal(maps.bumpMap.disposals, 1);
assert.equal(maps.roughnessMap.disposals, 1);
assert.notEqual(materials.getTextureSet(THREE, input), maps, "disposal should invalidate the cache");
materials.disposeTextureCache();

// Same file also exposes the browser global without CommonJS.
const browserContext = {};
vm.createContext(browserContext);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../material-system.js"), "utf8"), browserContext);
assert.equal(typeof browserContext.AtelierMaterials.createCladdingMaterial, "function");
assert.equal(browserContext.AtelierMaterials.resolveAppearance({ mode: "realistic", materialKey: "terracotta_brick" }).spandrelHex, 0xa34f38);
console.log("Material system: 6 surfaces, deterministic independent maps, atelier palettes, metre scale and texture lifecycle passed.");
