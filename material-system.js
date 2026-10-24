/*
 * Small, dependency-free facade material library for Three.js r128.
 * Surface colours and optical values are design-study assumptions, not measured
 * product samples or certified material performance. No image assets are fetched.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AtelierMaterials = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFINITIONS = Object.freeze({
    anodized_metal: Object.freeze({ key: "anodized_metal", nameKr: "아노다이징 알루미늄", descriptionKr: "은회색 금속 패널 · 세로 헤어라인", atelierHex: 0xc6bfb1, realisticHex: 0xb7bec1, roughness: 0.31, metalness: 0.78, bumpScale: 0.002, tileWidthM: 1.2, tileHeightM: 3.0, jointM: 0.009 }),
    terracotta_brick: Object.freeze({ key: "terracotta_brick", nameKr: "테라코타 적벽돌", descriptionKr: "소성 적갈색 · 엇갈린 벽돌 쌓기와 줄눈", atelierHex: 0xa47c65, realisticHex: 0xa34f38, roughness: 0.85, metalness: 0, bumpScale: 0.018, tileWidthM: 0.88, tileHeightM: 0.6, jointM: 0.009 }),
    limestone: Object.freeze({ key: "limestone", nameKr: "천연 라임스톤", descriptionKr: "웜 베이지 석재 · 수평 퇴적결과 대판 줄눈", atelierHex: 0xd2c5ae, realisticHex: 0xd9c7a6, roughness: 0.77, metalness: 0, bumpScale: 0.008, tileWidthM: 1.2, tileHeightM: 0.6, jointM: 0.006 }),
    granite_pocheon: Object.freeze({ key: "granite_pocheon", nameKr: "포천석 화강암", descriptionKr: "밝은 회색 · 세립 결정과 버너구이 표면", atelierHex: 0xcac5bb, realisticHex: 0xbcbdb7, roughness: 0.88, metalness: 0, bumpScale: 0.011, tileWidthM: 1.2, tileHeightM: 0.6, jointM: 0.006 }),
    uhpc_concrete: Object.freeze({ key: "uhpc_concrete", nameKr: "UHPC 콘크리트", descriptionKr: "중성 회색 · 미세 기공과 프리캐스트 패널 줄눈", atelierHex: 0xaaa597, realisticHex: 0xa6a8a4, roughness: 0.76, metalness: 0, bumpScale: 0.006, tileWidthM: 1.2, tileHeightM: 2.4, jointM: 0.009 }),
    champagne_bronze: Object.freeze({ key: "champagne_bronze", nameKr: "샴페인 브론즈", descriptionKr: "웜 브론즈 금속 · 은은한 세로 헤어라인", atelierHex: 0xb4a084, realisticHex: 0xb38a53, roughness: 0.29, metalness: 0.88, bumpScale: 0.002, tileWidthM: 1.2, tileHeightM: 3.0, jointM: 0.009 })
  });

  // Atelier values intentionally match the accepted editorial palette in app.js.
  const ARCHETYPES = Object.freeze({
    curtain_wall: { atelier: [0x8d8576, 0xc6bfb1, 0x909d97, 0xb5ab96], realistic: [0x818b8e, 0xb7bec1, 0x7192a0, 0xaa967d] },
    kinetic_louver: { atelier: [0xa18b6d, 0xaaa38f, 0x8c9890, 0xb6ac92], realistic: [0xa78a5e, 0xaab4b7, 0x72949a, 0xb3a389] },
    brick_rainscreen: { atelier: [0x62584c, 0xa47c65, 0x6d7770, 0xc0ad8e], realistic: [0x514b44, 0xa34f38, 0x53646b, 0xb09a7b] },
    stone_ribbon: { atelier: [0x928a7b, 0xd2c5ae, 0x929d96, 0xbdb39f], realistic: [0x858b89, 0xd9c7a6, 0x7b98a1, 0xb0a690] },
    diagrid_biophilic: { atelier: [0xe4e0d3, 0xc8c8b7, 0x99a79a, 0xb9b39a], realistic: [0xe5e5df, 0xc8cdd0, 0x829f9b, 0xafa58b] }
  });

  const ACCENTS = Object.freeze({
    titanium: { atelier: [0xebe8df, 0xdedacf, 0xf1ede4], realistic: [0xe8e9e6, 0xd9ddde, 0xf0f0eb] },
    warm_limestone: { atelier: [0xb9ad99, 0xcbbda6, 0xe4dccf], realistic: [0xb4a38a, 0xd8c5a0, 0xe8ddc6] },
    champagne: { atelier: [0x9a8566, 0xb4a084, 0xd0c1ab], realistic: [0x99713d, 0xb38a53, 0xd8c19a] },
    terracotta: { atelier: [0x654d40, 0xa57961, 0xd7c7b6], realistic: [0x603f32, 0xab573c, 0xd7c5b2] },
    crimson_brick: { atelier: [0x443c35, 0x875f50, 0xc9bba9], realistic: [0x45332e, 0x8e3e32, 0xc9b7a9] },
    sage_patina: { atelier: [0x68745e, 0x8b957b, 0xc8cbb7], realistic: [0x426e61, 0x648e7b, 0xc1d1c3] },
    sapphire: { atelier: [0x9da6a0, 0x667981, 0xd0d2c8], realistic: [0x8d9da4, 0x3c6179, 0xc8d0d2] },
    basalt_charcoal: { atelier: [0x494c44, 0x676b60, 0xa6aa9c], realistic: [0x3d4346, 0x596064, 0xa4abad] }
  });

  const GLASS = Object.freeze({
    sapphire_blue: { atelier: [0x7c9198, 0x9baaa5], realistic: [0x5e8da5, 0x9aabb0] },
    crystal_clear: { atelier: [0xc6d0c5, 0xd6cebb], realistic: [0xc6d6d5, 0xd4d0bf] },
    emerald_green: { atelier: [0x879b83, 0xa6b28e], realistic: [0x659482, 0xa0b39a] },
    bronze_gold: { atelier: [0xa18b6e, 0xc3ad85], realistic: [0xa58050, 0xc2a36e] },
    smoke_grey: { atelier: [0x818980, 0xa5aa9b], realistic: [0x75848a, 0xa5aca6] }
  });

  const LIGHTING_NOTE_KR = "참고 색감입니다. 조도·태양 방향·야간 조명·모니터와 실제 제품에 따라 색과 반사감이 달라집니다.";
  const PERFORMANCE_NOTE_KR = "시각화용 표면 가정이며 제조사 실측 색상·성능 인증값이 아닙니다.";
  const textureCaches = new Map();
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const normalizedMode = mode => mode === "realistic" ? "realistic" : "atelier";
  const getDefinition = key => DEFINITIONS[key] || DEFINITIONS.anodized_metal;
  const rgb = hex => [(hex >>> 16) & 255, (hex >>> 8) & 255, hex & 255];

  function resolveAppearance(options) {
    const opt = options || {};
    const mode = normalizedMode(opt.mode);
    const definition = getDefinition(opt.materialKey);
    const arch = (ARCHETYPES[opt.facadeType] || ARCHETYPES.curtain_wall)[mode];
    const accent = ACCENTS[opt.accentKey] ? ACCENTS[opt.accentKey][mode] : null;
    const glass = GLASS[opt.glassTintKey] ? GLASS[opt.glassTintKey][mode] : [arch[2], arch[3]];
    const isDay = opt.isDay !== false;
    // The old atelier automatic choice followed the archetype. Actual-colour
    // mode follows the selected surface material so stone cannot look like metal.
    const autoSpandrel = mode === "atelier" ? arch[1] : definition.realisticHex;
    return Object.assign({}, definition, {
      mode, frameHex: accent ? accent[0] : arch[0],
      spandrelHex: accent ? accent[1] : autoSpandrel,
      slabHex: accent ? accent[2] : (opt.facadeType === "brick_rainscreen" ? 0xd2c3b0 : (isDay ? 0xe3dcd0 : 0xc0b8a7)),
      glassHex: glass[isDay ? 0 : 1], lightingNoteKr: LIGHTING_NOTE_KR,
      performanceNoteKr: PERFORMANCE_NOTE_KR
    });
  }

  // Integer hash makes regenerating a facade completely deterministic. Geometry
  // studies and page navigation do not cause random surface flicker.
  function noise(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed | 0);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function edgeDistance(value, period) {
    const local = ((value % period) + period) % period;
    return Math.min(local, period - local);
  }

  /** Pure CPU pixels, also usable by tests/exporters without a browser or Three. */
  function generateTexturePixels(options) {
    const opt = options || {};
    const originalDefinition = getDefinition(opt.materialKey);
    const jointM = Number.isFinite(Number(opt.jointMm)) ? clamp(Number(opt.jointMm), 3, 25) / 1000 : originalDefinition.jointM;
    const definition = Object.assign({}, originalDefinition, { jointM });
    const mode = normalizedMode(opt.mode);
    const size = clamp(Math.floor(Number(opt.size) || 256), 16, 1024);
    const seed = Number.isFinite(opt.seed) ? opt.seed | 0 : 7301;
    const baseHex = Number.isInteger(opt.baseHex) ? opt.baseHex : definition[mode + "Hex"];
    const base = rgb(baseHex);
    const albedo = new Uint8ClampedArray(size * size * 4);
    const bump = new Uint8ClampedArray(size * size * 4);
    const roughness = new Uint8ClampedArray(size * size * 4);
    const metal = definition.metalness > 0.5;

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (px + 0.5) / size * definition.tileWidthM;
        const y = (py + 0.5) / size * definition.tileHeightM;
        const grain = noise(px, py, seed) - 0.5;
        const cloud = noise(Math.floor(px / 18), Math.floor(py / 18), seed + 41) - 0.5;
        let seam = edgeDistance(x, definition.tileWidthM) < definition.jointM / 2 || edgeDistance(y, definition.tileHeightM) < definition.jointM / 2;
        let variation = grain * 5 + cloud * 4;
        let relief = 168 + grain * 13;
        let surfaceRoughness = definition.roughness + grain * 0.06;
        let colour = base;

        if (definition.key === "terracotta_brick") {
          const courseHeight = 0.075, brickWidth = 0.22;
          const row = Math.floor(y / courseHeight);
          const shiftedX = x + (row % 2) * brickWidth / 2;
          const col = Math.floor(shiftedX / brickWidth);
          seam = edgeDistance(y, courseHeight) < definition.jointM / 2 || edgeDistance(shiftedX, brickWidth) < definition.jointM / 2;
          variation = (noise(col, row, seed + 11) - 0.5) * 23 + grain * 10;
          relief = 177 + grain * 27;
          if (seam) colour = mode === "atelier" ? [177, 166, 148] : [184, 175, 159];
        } else if (definition.key === "limestone") {
          const sediment = Math.sin(y * 104 + Math.sin(x * 14) * 1.4) * 1.8;
          variation = cloud * 8 + grain * 5 + sediment;
          relief = 170 + grain * 8 + sediment;
        } else if (definition.key === "granite_pocheon") {
          const crystal = noise(Math.floor(px / 2), Math.floor(py / 2), seed + 67);
          variation = crystal < 0.10 ? -38 : (crystal > 0.85 ? 22 : grain * 13);
          relief = 174 + grain * 34;
        } else if (definition.key === "uhpc_concrete") {
          const pore = noise(px, py, seed + 107) > 0.984;
          variation = cloud * 7 + grain * 4 - (pore ? 17 : 0);
          relief = 174 + grain * 9 - (pore ? 40 : 0);
        } else if (metal) {
          // Fine parallel brushing: optical grain is independent of seam relief.
          const brush = noise(px, 0, seed + 89) - 0.5;
          variation = brush * 5 + grain * 1.5;
          relief = 174 + brush * 5;
          surfaceRoughness += brush * 0.06;
        }

        if (seam) {
          relief = 65 + grain * 7;
          surfaceRoughness = metal ? 0.72 : 0.93;
          if (definition.key !== "terracotta_brick") {
            const factor = metal ? 0.57 : 0.69;
            colour = base.map(channel => channel * factor);
          }
          variation = grain * 4;
        }
        const i = (py * size + px) * 4;
        // Preserve characteristic warm or cool hues while varying brightness.
        for (let channel = 0; channel < 3; channel++) {
          albedo[i + channel] = clamp(Math.round(colour[channel] + variation), 0, 255);
          bump[i + channel] = clamp(Math.round(relief), 0, 255);
          roughness[i + channel] = Math.round(clamp(surfaceRoughness, 0.04, 1) * 255);
        }
        albedo[i + 3] = bump[i + 3] = roughness[i + 3] = 255;
      }
    }
    return { width: size, height: size, albedo, bump, roughness, definition, baseHex, seed, mode };
  }

  function canvasFromPixels(pixels, width, height, canvasFactory) {
    const canvas = canvasFactory ? canvasFactory() : document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Facade materials require a 2D canvas context.");
    const imageData = context.createImageData(width, height);
    imageData.data.set(pixels);
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Caller owns materials; this module owns/cache-shares all textures. The input
   * widthM/heightM are the real surface dimensions represented by UV 0..1.
   * For UVs already expressed in metres, pass widthM:1,heightM:1.
   */
  function getTextureSet(THREE, options) {
    const opt = options || {};
    const definition = getDefinition(opt.materialKey);
    const mode = normalizedMode(opt.mode);
    const widthM = Math.max(0.001, Number(opt.widthM) || 1);
    const heightM = Math.max(0.001, Number(opt.heightM) || 1);
    const size = clamp(Math.floor(Number(opt.size) || 256), 16, 1024);
    const baseHex = Number.isInteger(opt.baseHex) ? opt.baseHex : definition[mode + "Hex"];
    const seed = Number.isFinite(opt.seed) ? opt.seed | 0 : 7301;
    // Keep caches separate if two independently loaded Three runtimes coexist.
    if (!textureCaches.has(THREE)) textureCaches.set(THREE, new Map());
    const cache = textureCaches.get(THREE);
    const jointMm = Number.isFinite(Number(opt.jointMm)) ? clamp(Number(opt.jointMm), 3, 25) : definition.jointM * 1000;
    const cacheKey = [definition.key, mode, baseHex, seed, size, widthM, heightM, jointMm].join(":");
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const pixels = generateTexturePixels({ materialKey: definition.key, mode, baseHex, seed, size, jointMm });
    const makeTexture = (data, isColour) => {
      const texture = new THREE.CanvasTexture(canvasFromPixels(data, size, size, opt.canvasFactory));
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(widthM / definition.tileWidthM, heightM / definition.tileHeightM);
      // r128 uses encoding, not modern texture.colorSpace. Data maps stay linear.
      texture.encoding = isColour ? THREE.sRGBEncoding : THREE.LinearEncoding;
      texture.anisotropy = 4;
      texture.userData = Object.assign({}, texture.userData, { atelierShared: true, materialKey: definition.key, mode, dataRole: isColour ? "albedo" : "surface-data" });
      return texture;
    };
    const set = {
      map: makeTexture(pixels.albedo, true),
      bumpMap: makeTexture(pixels.bump, false),
      roughnessMap: makeTexture(pixels.roughness, false),
      tileWidthM: definition.tileWidthM, tileHeightM: definition.tileHeightM
    };
    set.bumpMap.userData.dataRole = "height";
    set.roughnessMap.userData.dataRole = "roughness";
    cache.set(cacheKey, set);
    return set;
  }

  function createCladdingMaterial(THREE, options) {
    const opt = options || {};
    const definition = getDefinition(opt.materialKey);
    const maps = getTextureSet(THREE, opt);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: maps.map, bumpMap: maps.bumpMap,
      bumpScale: definition.bumpScale, roughnessMap: maps.roughnessMap,
      // Map already stores absolute roughness; Three multiplies scalar × map.
      roughness: 1, metalness: definition.metalness,
      clippingPlanes: opt.clippingPlanes || null,
      envMap: opt.envMap || null, envMapIntensity: opt.envMapIntensity == null ? 0.75 : opt.envMapIntensity
    });
    material.name = "atelier-cladding:" + definition.key + ":" + normalizedMode(opt.mode);
    material.userData = Object.assign({}, material.userData, { atelierSurface: true, materialKey: definition.key, mode: normalizedMode(opt.mode) });
    return material;
  }

  function disposeTextureCache(THREE) {
    const entries = THREE ? [[THREE, textureCaches.get(THREE)]] : Array.from(textureCaches.entries());
    for (const entry of entries) {
      if (!entry[1]) continue;
      for (const set of entry[1].values()) {
        set.map.dispose();
        set.bumpMap.dispose();
        set.roughnessMap.dispose();
      }
      textureCaches.delete(entry[0]);
    }
  }

  /** Neutral studio reflection cards, with no change to scene.background. */
  function createEnvironmentMap(THREE, renderer, options) {
    const opt = options || {};
    const size = 128;
    const faces = [];
    for (let face = 0; face < 6; face++) {
      const canvas = opt.canvasFactory ? opt.canvasFactory() : document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const gradient = ctx.createLinearGradient(0, 0, 0, size);
      gradient.addColorStop(0, face === 3 ? "#777772" : "#d6d5ce");
      gradient.addColorStop(0.5, face === 3 ? "#999991" : "#b7b8b1");
      gradient.addColorStop(1, "#7d807a");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      if (face !== 3) {
        // Broad light cards make metal reflect neutral light rather than black.
        const light = ctx.createRadialGradient(size * 0.35, size * 0.25, 3, size * 0.35, size * 0.25, size * 0.8);
        light.addColorStop(0, "rgba(255,255,250,0.92)");
        light.addColorStop(0.45, "rgba(245,245,236,0.35)");
        light.addColorStop(1, "rgba(235,235,225,0)");
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, size, size);
      }
      faces.push(canvas);
    }
    const cube = new THREE.CubeTexture(faces);
    cube.encoding = THREE.sRGBEncoding;
    cube.needsUpdate = true;
    const generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromCubemap(cube);
    cube.dispose();
    generator.dispose();
    target.texture.userData = Object.assign({}, target.texture.userData, { atelierShared: true, neutralStudio: true });
    let disposed = false;
    return { texture: target.texture, dispose: function () { if (!disposed) { target.dispose(); disposed = true; } } };
  }

  return Object.freeze({
    definitions: DEFINITIONS, getDefinition, resolveAppearance, generateTexturePixels,
    getTextureSet, createCladdingMaterial, disposeTextureCache, createEnvironmentMap,
    lightingNoteKr: LIGHTING_NOTE_KR, performanceNoteKr: PERFORMANCE_NOTE_KR
  });
});
