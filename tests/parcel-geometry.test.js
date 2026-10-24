"use strict";
const assert = require("node:assert/strict");
const geometry = require("../parcel-geometry.js");
const clipping = require("../vendor/polygon-clipping-0.15.7.umd.min.js");

// Build WGS84 fixtures from known metre coordinates in the local frame used by
// the engine. Areas below are independent hand-calculated geometric examples.
const R = 6371008.8, RAD = Math.PI / 180, lon0 = 127, lat0 = 37.5;
const sx = R * RAD * Math.cos(lat0 * RAD), sz = R * RAD;
const wgs = ([x, z]) => [lon0 + x / sx, lat0 - z / sz];
const ring = points => points.map(wgs);
const box = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
const feature = (points, properties = {}) => ({ type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring(points)] } });
const dataset = features => ({ version: 1, source: "import", features });
const clone = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: ${actual} vs ${expected}`);
function assertSafeRectangle(result) {
  const { widthM: w, depthM: d } = result.rectangle;
  assert.ok(Number.isFinite(w) && Number.isFinite(d) && w > 0 && d > 0);
  assert.ok(w * d <= result.areaSqm + .0001);
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]];
  // Exact polygon difference, including holes. A bounding-box or four-corner
  // containment check alone would miss an interior hole or concave indentation.
  assert.equal(clipping.difference([corners], result.outlines).length, 0, "returned rectangle must have no portion outside parcel union");
  assert.equal(geometry.contained(result.outlines, 0, 0, w, d), true);
}

assert.equal(geometry.sanitizeParcelData(null), null);
assert.equal(geometry.derive(null), null);
assert.equal(geometry.derive(undefined), null);
const rectangleInput = dataset([feature(box(0, 0, 20, 10), { pnu: "1168010100100010000", address: "검증용 필지", source: "test fixture" })]);
rectangleInput.fetchedAt = "2026-10-21T00:00:00.000Z";
const rectangle = geometry.derive(rectangleInput);
close(rectangle.areaSqm, 200, "20m by 10m rectangle");
close(rectangle.rectangle.widthM, 20, "rectangle width"); close(rectangle.rectangle.depthM, 10, "rectangle depth");
close(rectangle.rectangle.centerX, 10, "rectangle center X"); close(rectangle.rectangle.centerZ, 5, "rectangle center Z");
assert.equal(rectangle.featureCount, 1); assert.deepEqual(rectangle.pnus, ["1168010100100010000"]); assert.equal(rectangle.fetchedAt, rectangleInput.fetchedAt);
assertSafeRectangle(rectangle);
const clean = geometry.sanitizeParcelData(rectangleInput); clean.features[0].geometry.coordinates[0][0][0] += .001;
assert.equal(rectangleInput.features[0].geometry.coordinates[0][0][0], lon0, "sanitizer must copy coordinate arrays rather than mutate input");

const adjacent = geometry.derive(dataset([feature(box(0, 0, 20, 10)), feature(box(20, 0, 40, 10))]));
close(adjacent.areaSqm, 400, "edge-adjacent union"); close(adjacent.rectangle.widthM, 40, "adjacent parcels form one rectangle");
assert.equal(adjacent.featureCount, 2); assertSafeRectangle(adjacent);
const overlapping = geometry.derive(dataset([feature(box(0, 0, 20, 10)), feature(box(10, 0, 30, 10))]));
close(overlapping.areaSqm, 300, "overlap must be counted only once"); close(overlapping.rectangle.widthM, 30, "overlap union width"); assertSafeRectangle(overlapping);
const duplicate = geometry.derive(dataset([feature(box(0, 0, 20, 10)), feature(box(0, 0, 20, 10))])); close(duplicate.areaSqm, 200, "identical footprints cannot double site area");
assert.throws(() => geometry.derive(dataset([feature(box(0, 0, 20, 10)), feature(box(25, 0, 45, 10))])), /떨어진/);
assert.throws(() => geometry.derive(dataset([feature(box(0, 0, 20, 10)), feature(box(20, 10, 40, 20))])), /떨어진/, "point-only contact cannot create a connected building envelope");

const concave = geometry.derive(dataset([feature([[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40], [0, 0]])]));
close(concave.areaSqm, 700, "L shaped parcel"); assertSafeRectangle(concave);
const cr = concave.rectangle;
assert.ok(cr.centerX + cr.widthM / 2 <= 10 + .0001 || cr.centerZ + cr.depthM / 2 <= 10 + .0001, "L-shape rectangle may occupy one arm, never bridge the missing corner");
const holedInput = dataset([feature(box(0, 0, 50, 50))]);
holedInput.features[0].geometry.coordinates.push(ring(box(20, 20, 30, 30)));
const holed = geometry.derive(holedInput); close(holed.areaSqm, 2400, "hole area must be subtracted"); assertSafeRectangle(holed);
assert.ok(holed.rectangle.widthM * holed.rectangle.depthM < 2500, "rectangle must not bridge central hole");
const filledInput = clone(holedInput); filledInput.features.push(feature(box(20, 20, 30, 30)));
const filled = geometry.derive(filledInput); close(filled.areaSqm, 2500, "second parcel fills the hole"); assertSafeRectangle(filled);

const multi = dataset([{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[ring(box(0, 0, 20, 10))], [ring(box(20, 0, 40, 10))]] } }]);
const multiResult = geometry.derive(multi); close(multiResult.areaSqm, 400, "adjacent components of MultiPolygon"); assertSafeRectangle(multiResult);
const reversed = clone(rectangleInput); reversed.features[0].geometry.coordinates[0].reverse(); close(geometry.derive(reversed).areaSqm, 200, "orientation-independent area");

const bad = mutate => { const value = clone(rectangleInput); mutate(value); assert.throws(() => geometry.sanitizeParcelData(value)); };
bad(v => { v.version = 2; }); bad(v => { v.source = "trusted"; }); bad(v => { v.extra = true; });
bad(v => { v.features = []; }); bad(v => { v.features = Array.from({ length: 6 }, () => v.features[0]); });
bad(v => { v.features[0].type = "FeatureCollection"; }); bad(v => { v.features[0].geometry.type = "LineString"; });
bad(v => { v.features[0].properties.pnu = "123"; }); bad(v => { v.features[0].properties.pnu = 1168010100100010000; });
bad(v => { v.features[0].properties.address = "\u0000bad"; }); bad(v => { v.features[0].properties.extra = true; });
bad(v => { v.fetchedAt = "not a date"; }); bad(v => { v.fetchedAt = "2026-13-01T00:00:00Z"; });
bad(v => { v.features[0].geometry.coordinates[0][1][0] = 0; });
bad(v => { v.features[0].geometry.coordinates[0][1][1] = 90; });
bad(v => { v.features[0].geometry.coordinates[0][1][0] = Infinity; });
bad(v => { v.features[0].geometry.coordinates[0][1].push(0); });
bad(v => { v.features[0].geometry.coordinates[0].pop(); });
bad(v => { v.features[0].geometry.coordinates[0] = ring([[0, 0], [10, 10], [20, 20], [0, 0]]); });
bad(v => { v.features[0].geometry.coordinates[0] = ring([[0, 0], [20, 20], [0, 20], [20, 0], [30, 10], [0, 0]]); });
bad(v => { v.features[0].geometry.coordinates[0].splice(1, 0, v.features[0].geometry.coordinates[0][0]); });
bad(v => { v.features[0].geometry.coordinates.push(ring(box(30, 30, 40, 40))); });
bad(v => { v.features[0].geometry.coordinates.push(ring(box(19, 2, 22, 4))); });
const badHoles = clone(holedInput); badHoles.features[0].geometry.coordinates.push(ring(box(25, 25, 35, 35))); assert.throws(() => geometry.sanitizeParcelData(badHoles), /공백|교차/);
const nestedHoles = clone(holedInput); nestedHoles.features[0].geometry.coordinates.push(ring(box(22, 22, 28, 28))); assert.throws(() => geometry.sanitizeParcelData(nestedHoles), /중첩/);
const many = clone(rectangleInput); const circle = Array.from({ length: 2000 }, (_, i) => wgs([10 + 5 * Math.cos(i * 2 * Math.PI / 2000), 10 + 5 * Math.sin(i * 2 * Math.PI / 2000)])); circle.push([...circle[0]]); many.features[0].geometry.coordinates = [circle]; assert.throws(() => geometry.sanitizeParcelData(many), /2,000/);
const huge = dataset([feature(box(0, 0, 2100, 10))]); assert.throws(() => geometry.derive(huge), /범위/);
console.log("parcel geometry: known metre areas, overlap subtraction, adjacency, separation, concavity, holes, exact rectangle containment and invalid input validation passed");
