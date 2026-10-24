/** Legacy About URLs share the journal. Photographic scenes live in atelier-motion.js. */
(() => {
  "use strict";
  if (document.body.dataset.sitePage === "about-redirect") {
    const destinations = new Set(["#perspective", "#method", "#researcher", "#approach"]);
    let hash;
    try { hash = decodeURIComponent(location.hash); } catch (_) { hash = ""; }
    location.replace(new URL(`./${destinations.has(hash) ? hash : "#about"}`, location.href));
    return;
  }

})();
