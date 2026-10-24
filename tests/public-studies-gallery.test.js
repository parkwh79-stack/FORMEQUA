"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeStudy, mergePage, mount } = require("../studies-gallery.js");
const origin = "https://formequa.example";
const record = { id: "study-12345678", program: "hotel", source: "pilot-study", imageKind: "ai-concept", renderVersion: 2, imageUrl: "/api/v1/studies/study-12345678/image.png", title: "<img onerror=alert(1)>", siteAreaSqm: 1200, farPct: 250, bcrPct: 50, floors: 7, createdAt: "2026-10-21T00:00:00Z" };
assert.equal(normalizeStudy(record, origin).title, "호텔 AI 건축 이미지");
assert.equal(normalizeStudy(record, origin).imageUrl, record.imageUrl + "?v=2");
assert.equal(normalizeStudy({ ...record, renderVersion: 3 }, origin).imageUrl, record.imageUrl + "?v=3");
for (const imageUrl of ["https://external.example/api/v1/studies/study-12345678/image.png", "//external.example/image.png", "javascript:alert(1)", "/api/v1/studies/another-study/image.png", "/api/v1/studies/study-12345678/image.png?private=1", "/api/v1/studies/study-12345678/image.png#fragment"]) {
  assert.equal(normalizeStudy({ ...record, imageUrl }, origin), null, `Reject unexpected image URL: ${imageUrl}`);
}
assert.equal(normalizeStudy({ ...record, source: "private-project" }, origin), null);
for (const imageKind of [undefined, "webgl", "model-render", "image", "ai-concept-with-address"]) {
  assert.equal(normalizeStudy({ ...record, imageKind }, origin), null, "Only an explicit AI-concept publication can enter this portfolio");
}
assert.equal(normalizeStudy({ ...record, renderVersion: 1 }, origin), null);
assert.equal(normalizeStudy({ ...record, id: "../private" }, origin), null);
assert.equal(normalizeStudy({ ...record, program: "<script>" }, origin), null);
assert.equal(normalizeStudy({ ...record, program: "__proto__" }, origin), null);
const publicImage = normalizeStudy({ ...record, siteAreaSqm: "1200", farPct: Infinity, bcrPct: 101, floors: -1 }, origin);
for (const key of ["siteAreaSqm", "farPct", "bcrPct", "floors", "program", "programEn"]) assert.equal(Object.hasOwn(publicImage, key), false);
assert.equal(normalizeStudy({ ...record, createdAt: "not a date" }, origin).createdAt, null);
assert.equal(Object.hasOwn(normalizeStudy({ ...record, address: "private address", pnu: "private PNU", finance: { value: 100 } }, origin), "address"), false);

const example = number => {
  const id = number.toString(16).padStart(24, "0");
  return { ...record, id, imageUrl: `/api/v1/studies/${id}/image.png`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, number)).toISOString() };
};
const all = Array.from({ length: 73 }, (_, index) => example(index + 1)).reverse();
let collection = { records: [], total: 0, nextOffset: 0 };
for (let offset = 0; offset < all.length; offset += 6) {
  collection = mergePage(collection, { studies: all.slice(offset, offset + 6), total: all.length, nextOffset: offset + 6 < all.length ? offset + 6 : null }, origin);
}
assert.equal(collection.records.length, 73, "All pages remain available beyond the former sixty-record ceiling");
assert.equal(collection.nextOffset, null);
const newer = example(74);
collection = mergePage(collection, { studies: [newer, ...all.slice(0, 5)], total: 74, nextOffset: 6 }, origin, true);
assert.equal(collection.records.length, 74, "Newest refresh preserves already loaded older studies");
assert.equal(collection.records[0].id, newer.id);
assert.equal(collection.records.at(-1).id, all.at(-1).id);
assert.equal(collection.nextOffset, null);
let partial = mergePage({ records: [], total: 0, nextOffset: 0 }, { studies: all.slice(0, 6), total: 73, nextOffset: 6 }, origin);
partial = mergePage(partial, { studies: [newer, ...all.slice(0, 5)], total: 74, nextOffset: 6 }, origin, true);
assert.equal(partial.nextOffset, 7, "One new study shifts the existing paging frontier");
assert.equal(partial.records.length, 7);
partial = mergePage(partial, { studies: [all[5], ...all.slice(6, 11)], total: 74, nextOffset: 13 }, origin);
assert.equal(partial.records.length, 12, "Overlapping pages never duplicate cards");
const burst = Array.from({ length: 12 }, (_, index) => example(100 + index)).reverse();
partial = mergePage(partial, { studies: burst.slice(0, 6), total: 86, nextOffset: 6 }, origin, true);
assert.equal(partial.nextOffset, 6, "A larger publishing burst does not skip the unseen middle pages");
assert.equal(mergePage(partial, { studies: [], total: 80, nextOffset: -1 }, origin), null);
assert.equal(mergePage(partial, { studies: [], total: "80", nextOffset: null }, origin), null);

// A minimal DOM verifies the mounted load-more button actually requests later server pages.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.hidden = false; this.attributes = {}; }
  append(...nodes) { for (const node of nodes) this.children.push(...(node.tag === "fragment" ? node.children : [node])); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  contains(node) { return this.children.includes(node) || this.children.some(child => child.contains?.(node)); }
  focus() {}
  scrollIntoView() {}
  close() { this.open = false; }
  showModal() { this.open = true; }
  remove() { this.removed = true; }
}
(async () => {
  const ids = Object.fromEntries(["studyAiDirection", "aiReferenceStudy", "btnAiReferenceStudy", "publicStudiesGrid", "btnMorePublicStudies", "publicStudiesStatus"].map(id => [id, new Element("div")]));
  ids.aiReferenceStudy.append(ids.btnAiReferenceStudy);
  ids.publicStudiesGrid.append(ids.aiReferenceStudy);
  const events = {}, requested = [];
  const document = { readyState: "complete", visibilityState: "visible", activeElement: null, body: new Element("body"), getElementById: id => ids[id], createElement: tag => new Element(tag), createDocumentFragment: () => new Element("fragment"), addEventListener() {} };
  const window = { document, location: { origin, hash: "" }, setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), addEventListener: (name, callback) => { events[name] = callback; },
    fetch: async url => { const query = new URL(url, origin).searchParams, limit = Number(query.get("limit")), offset = Number(query.get("offset")); requested.push(offset);
      return { ok: true, json: async () => ({ studies: all.slice(offset, offset + limit), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null }) }; } };
  mount(window);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ids.publicStudiesGrid.children.length, 7);
  assert.equal(ids.publicStudiesGrid.children[0], ids.aiReferenceStudy, "Permanent AI reference remains visible before the live portfolio");
  for (let page = 1; page < 13; page++) await ids.btnMorePublicStudies.events.click();
  assert.equal(ids.publicStudiesGrid.children.length, 74);
  assert.ok(requested.includes(60) && requested.includes(72));
  assert.equal(ids.btnMorePublicStudies.hidden, true);
  assert.doesNotMatch(ids.publicStudiesStatus.textContent, /공개 연구|살펴보는 중|73/);
  const text = node => [node.textContent || "", ...node.children.map(text)].join(" ");
  assert.doesNotMatch(text(ids.publicStudiesGrid), /FAR|㎡|15F|공간 연구|HOTEL|OFFICE/);
  const firstAi = ids.publicStudiesGrid.children[1].children[0];
  firstAi.events.click();
  const modal = document.body.children.at(-1);
  assert.equal(modal.tag, "dialog");
  assert.match(text(modal), /AI VISUAL STUDY/);
  assert.doesNotMatch(text(modal), /대지면적|용적률|건폐율|지상 규모|㎡|FAR/);
  ids.btnAiReferenceStudy.events.click();
  assert.match(text(document.body.children.at(-1)), /Architectural concept/);

  // The AI reference is a real static image even when the generated portfolio is empty/offline.
  for (const offline of [false, true]) {
    const localIds = Object.fromEntries(Object.keys(ids).map(id => [id, new Element("div")]));
    localIds.aiReferenceStudy.append(localIds.btnAiReferenceStudy);
    localIds.publicStudiesGrid.append(localIds.aiReferenceStudy);
    let redirected = "", scrolled = false;
    localIds.studyAiDirection.scrollIntoView = () => { scrolled = true; };
    const localWindow = { ...window, location: { origin, hash: "#ongoingStudies" }, history: { replaceState: (_, __, hash) => { redirected = hash; } }, document: { ...document, getElementById: id => localIds[id] },
      fetch: async () => { if (offline) throw new Error("offline"); return { ok: true, json: async () => ({ studies: [], total: 0, nextOffset: null }) }; } };
    mount(localWindow);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(localIds.studyAiDirection.hidden, false);
    assert.equal(localIds.publicStudiesGrid.children.length, 1);
    assert.equal(localIds.publicStudiesGrid.children[0], localIds.aiReferenceStudy);
    assert.equal(redirected, "#studyAiDirection");
    assert.equal(scrolled, true);
    assert.equal(localIds.btnMorePublicStudies.hidden, true);
  }

  // Stateless deployments retain the permanent reference modal without polling
  // a remote collection or registering background refresh listeners.
  const staticIds = Object.fromEntries(Object.keys(ids).map(id => [id, new Element("div")]));
  staticIds.aiReferenceStudy.append(staticIds.btnAiReferenceStudy);
  staticIds.publicStudiesGrid.append(staticIds.aiReferenceStudy);
  const staticBody = new Element("body");
  const staticWindow = { ...window, FORMEQUA_DEPLOYMENT: { remoteStudiesEnabled: false },
    document: { ...document, body: staticBody, getElementById: id => staticIds[id],
      addEventListener() { throw new Error("No remote collection refresh listeners"); } },
    fetch() { throw new Error("No remote collection requests"); },
    addEventListener() { throw new Error("No remote collection refresh listeners"); },
    setInterval() { throw new Error("No remote collection timer"); } };
  mount(staticWindow);
  assert.equal(staticIds.publicStudiesGrid.children.length, 1);
  assert.equal(staticIds.publicStudiesGrid.children[0], staticIds.aiReferenceStudy);
  assert.equal(staticIds.btnMorePublicStudies.hidden, true);
  staticIds.btnAiReferenceStudy.events.click();
  assert.equal(staticBody.children.at(-1).tag, "dialog");
  assert.match(text(staticBody.children.at(-1)), /Architectural concept/);

  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.doesNotMatch(html, /THE GROWING COLLECTION|쌓여가는 공간의 가능성|공개 연구|ongoingStudiesTitle|id="ongoingStudies"/);
  assert.match(html, /<details class="study-ai-direction" id="studyAiDirection"/);
  assert.doesNotMatch(html.match(/<details class="study-ai-direction"[^>]*>/)[0], /\sopen(?:\s|=|>)/);
  assert.match(html, /id="aiReferenceStudy"/);
  assert.equal((html.match(/data-parcel="/g) || []).length, 4, "The four selected editorial studies remain intact");
  console.log("public-studies-gallery: AI-only portfolio, privacy, permanent reference, safe modal, legacy anchor and persistent paging passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
