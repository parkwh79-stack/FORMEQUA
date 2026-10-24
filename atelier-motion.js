/** FORMEQUA's letter entrances, photographic scenes and image curtains. */
(() => {
  "use strict";
  if (!document.body.classList.contains("atelier-motion")) return;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const supported = "IntersectionObserver" in window && typeof Element.prototype.animate === "function";
  const animations = new Set();
  let enhanced = supported && !preference.matches;
  let frame = 0;
  let observer;
  const photoTargets = new Map();
  const photoScenes = [];
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  function animate(node, frames, options) {
    if (!node.animate || !enhanced) return;
    const animation = node.animate(frames, options);
    animations.add(animation);
    animation.finished.catch(() => {}).finally(() => { animations.delete(animation); animation.cancel(); });
    return animation;
  }

  function words(element) {
    if (element.dataset.typePrepared) return;
    element.dataset.typePrepared = "true";
    element.classList.remove("reveal");
    if (!element.hasAttribute("aria-label")) element.setAttribute("aria-label", element.innerText.replace(/\s+/g, " ").trim());
    let index = 0;
    const walk = parent => {
      for (const node of [...parent.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE) {
          const fragment = document.createDocumentFragment();
          for (const word of node.textContent.split(/(\s+)/)) {
            if (!word || /^\s+$/.test(word)) { fragment.append(document.createTextNode(word)); continue; }
            const clip = document.createElement("span"), ink = document.createElement("span");
            clip.className = "motion-clip"; clip.setAttribute("aria-hidden", "true");
            ink.className = "motion-ink"; ink.textContent = word; ink.dataset.typeIndex = String(index++);
            clip.append(ink); fragment.append(clip);
          }
          node.replaceWith(fragment);
        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== "BR") walk(node);
      }
    };
    walk(element);
  }

  function revealTitle(element, order, delay = 0) {
    if (element.classList.contains("text-visible")) return;
    element.classList.add("text-visible");
    const horizontal = element.dataset.motionAxis === "x" || order % 3 === 1;
    const direction = order % 2 ? 1 : -1;
    [...element.querySelectorAll(".motion-ink")].forEach((ink, i) => {
      const from = horizontal ? `translate3d(${direction * 110}%,0,0) rotate(${direction * 2}deg)` : `translate3d(0,115%,0) rotate(${direction * 2}deg)`;
      animate(ink, [{ transform: from, opacity: .1 }, { transform: "translate3d(0,0,0) rotate(0deg)", opacity: 1 }],
        { duration: 1100, delay: delay + Math.min(i * 105, 650), easing: "cubic-bezier(.18,.7,.25,1)", fill: "both" });
    });
  }

  function revealPhoto(element, delay = 0) {
    if (element.classList.contains("image-visible")) return;
    element.classList.add("image-visible");
    const from = { left: "inset(0 100% 0 0)", right: "inset(0 0 0 100%)", down: "inset(0 0 100% 0)", up: "inset(100% 0 0 0)" }[element.dataset.motionImage] || "inset(100% 0 0 0)";
    animate(element, [{ clipPath: from }, { clipPath: "inset(0 0 0 0)" }], { duration: 1450, delay, easing: "cubic-bezier(.2,.65,.25,1)", fill: "both" });
    const image = element.querySelector("img");
    if (image) animate(image, [{ transform: "scale(1.075)" }, { transform: "scale(1)" }], { duration: 1800, delay, easing: "cubic-bezier(.2,.65,.25,1)", fill: "both" });
  }

  function heroLetters() {
    document.querySelectorAll("[data-hero-type]").forEach((line, row) => {
      const text = line.textContent;
      line.replaceChildren();
      [...text].forEach((letter, i) => {
        if (letter === " ") { line.append(document.createTextNode(" ")); return; }
        const glyph = document.createElement("span"); glyph.className = "hero-glyph"; glyph.textContent = letter; line.append(glyph);
        animate(glyph, [{ transform: `translate3d(${row === 1 ? 25 : -15}px,${row === 2 ? -80 : 95}%,0) rotate(${row === 1 ? 6 : -4}deg)`, opacity: 0 }, { transform: "translate3d(0,0,0) rotate(0)", opacity: 1 }],
          { duration: 1500, delay: 170 + row * 240 + i * 30, easing: "cubic-bezier(.18,.7,.25,1)", fill: "both" });
      });
      line.classList.add("text-visible");
    });
  }

  function preparePhotoScenes() {
    document.querySelectorAll('[data-scroll-scene],[data-method-scene]').forEach(scene => {
      const method = scene.hasAttribute('data-method-scene');
      photoScenes.push({
        scene, method, token: 0, running: new Set(),
        stage: scene.querySelector(method ? '.about-method-stage' : '.manifesto-stage'),
        photos: [...scene.querySelectorAll(method ? '.method-photo' : '.manifest-photo')],
        lines: [...scene.querySelectorAll(method ? '[data-method-word]' : '[data-manifest-line]')]
      });
    });
    setPhotoScenePreference();
  }

  function resetPhotoScene(item, state = 'waiting') {
    item.token++;
    for (const animation of item.running) animation.cancel();
    item.running.clear();
    item.scene.dataset.photoState = state;
  }

  function setPhotoScenePreference() {
    photoScenes.forEach(item => {
      item.scene.classList.toggle('photo-scene-ready', enhanced);
      item.scene.dataset.photoMotion = enhanced ? 'active' : 'static';
      if (item.method) {
        item.scene.closest('.about-formequa')?.classList.toggle('method-enhanced', enhanced);
        item.scene.dataset.methodMotion = enhanced ? 'active' : 'static';
      }
      resetPhotoScene(item, enhanced ? 'waiting' : 'static');
    });
  }

  function playPhotoScene(item) {
    const token = ++item.token;
    item.scene.dataset.photoState = 'playing';
    item.scene.dataset.photoEnterCount = String(Number(item.scene.dataset.photoEnterCount || 0) + 1);
    const easing = 'cubic-bezier(.18,.72,.22,1)';
    const run = (node, frames, duration, delay = 0) => {
      const animation = animate(node, frames, {duration, delay, easing, fill: 'both'});
      if (animation) item.running.add(animation);
    };
    item.photos.forEach((photo, i) => {
      // One architectural sweep per photograph, rather than a scroll-scrubbed drift.
      const curtain = i ? 'inset(0 0 100% 0)' : 'inset(0 100% 0 0)';
      run(photo, [
        {clipPath: curtain, transform: 'translate3d(0,18px,0)'},
        {clipPath: 'inset(0 0 0 0)', transform: 'translate3d(0,0,0)'}
      ], 1500, i * 140);
      const image = photo.querySelector('img');
      if (image) run(image, [{transform: 'scale(1.075)'}, {transform: 'scale(1)'}], 1900, i * 140);
    });
    item.lines.forEach((line, i) => {
      run(line, [
        {transform: 'translate3d(0,18px,0)', opacity: 0},
        {transform: 'translate3d(0,0,0)', opacity: 1}
      ], 1150, 220 + i * 120);
    });
    Promise.allSettled([...item.running].map(animation => animation.finished)).then(() => {
      if (item.token !== token) return;
      item.running.clear();
      item.scene.dataset.photoState = 'settled';
    });
  }

  function updatePhotoScenes(height) {
    photoScenes.forEach(item => {
      const rect = item.scene.getBoundingClientRect();
      const progress = clamp(-rect.top / Math.max(1, item.scene.offsetHeight - height));
      item.scene.dataset[item.method ? 'methodProgress' : 'motionProgress'] = progress.toFixed(3);
      // Leaving the entire scene rearms it for a later visit in either direction.
      if (rect.bottom < 0 || rect.top > height + 80) {
        if (item.scene.dataset.photoState !== 'waiting') resetPhotoScene(item);
        return;
      }
      if (!item.stage || item.scene.dataset.photoState !== 'waiting') return;
      const stage = item.stage.getBoundingClientRect();
      const visible = Math.min(stage.bottom, height - 30) - Math.max(stage.top, 100);
      if (visible >= Math.min(stage.height * .3, height * .28)) playPhotoScene(item);
    });
  }

  function updateScroll() {
    frame = 0;
    if (!enhanced) return;
    const height = window.innerHeight;
    const hero = document.getElementById("home");
    if (hero) {
      const rect = hero.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= height) {
        const p = clamp(-rect.top / Math.max(1, rect.height));
        hero.style.setProperty("--hero-image-y", `${p * 70}px`);
        hero.querySelectorAll(".hero-title-line").forEach((line, i) => {
          line.style.setProperty("--hero-copy-x", `${p * [45,-65,90][i]}px`);
          line.style.setProperty("--hero-copy-y", `${p * [35,-10,-40][i]}px`);
        });
      }
    }
    updatePhotoScenes(height);
  }

  function scheduleScroll() { if (!frame) frame = requestAnimationFrame(updateScroll); }

  window.addEventListener("DOMContentLoaded", () => {
    const titles = [...document.querySelectorAll("[data-motion-title]")];
    titles.forEach((element, i) => { words(element); element.dataset.motionOrder = String(i); });
    document.body.classList.toggle("motion-enhanced", enhanced);
    document.body.dataset.atelierMotion = enhanced ? "active" : "static";
    preparePhotoScenes();
    heroLetters();
    if (!supported) {
      titles.forEach(el => el.classList.add("text-visible"));
      document.querySelectorAll("[data-motion-image]").forEach(el => el.classList.add("image-visible"));
      return;
    }
    observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      if (entry.target.hasAttribute("data-motion-sequence")) {
        entry.target.dataset.sequencePlayed = "true";
        entry.target.querySelectorAll("[data-motion-title]").forEach(el => revealTitle(el, Number(el.dataset.motionOrder || 0), el.classList.contains("study-district") ? 0 : 650));
        entry.target.querySelectorAll("[data-motion-image]").forEach(el => revealPhoto(el, 180));
      }
      const photos = photoTargets.get(entry.target);
      if (photos) photos.forEach(revealPhoto);
      if (entry.target.hasAttribute("data-motion-title")) revealTitle(entry.target, Number(entry.target.dataset.motionOrder || 0));
      observer.unobserve(entry.target);
    }), { rootMargin: "0px 0px -7% 0px", threshold: .16 });
    document.querySelectorAll("[data-motion-sequence]").forEach(el => observer.observe(el));
    titles.filter(el => !el.closest("[data-motion-sequence]")).forEach(el => observer.observe(el));
    // Observe the stable parent; a fully clipped photo has no visible intersection.
    document.querySelectorAll("[data-motion-image]").forEach(el => {
      if (el.closest("[data-motion-sequence]")) return;
      const target = el.parentElement;
      const photos = photoTargets.get(target) || [];
      photos.push(el); photoTargets.set(target, photos); observer.observe(target);
    });
    window.addEventListener("scroll", scheduleScroll, { passive: true });
    window.addEventListener("resize", scheduleScroll, { passive: true });
    window.addEventListener("pageshow", scheduleScroll);
    preference.addEventListener("change", () => {
      enhanced = supported && !preference.matches;
      document.body.classList.toggle("motion-enhanced", enhanced);
      document.body.dataset.atelierMotion = enhanced ? "active" : "static";
      if (!enhanced) {
        for (const animation of animations) animation.cancel();
      }
      setPhotoScenePreference();
      scheduleScroll();
    });
    scheduleScroll();
  });
})();
