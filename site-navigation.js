/** Shared public-site navigation. Anchors have real hrefs; no calculation state is owned here. */
(() => {
  "use strict";
  const body = document.body;
  if (!body.dataset.sitePage) return;
  const header = document.getElementById("editorialHeader");
  const navigation = document.getElementById("editorialNavigation");
  const menu = document.getElementById("menuToggle");
  const mobile = matchMedia("(max-width: 960px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const routes = [...document.querySelectorAll("[data-nav-route]")];
  const sections = [...document.querySelectorAll("[data-nav-section]")];
  let frame = 0;
  let bootInteraction = false;
  const originalHash = location.hash;
  const canonicalPath = pathname => pathname.replace(/\/index\.html$/, "/");
  const samePage = url => url.origin === location.origin && canonicalPath(url.pathname) === canonicalPath(location.pathname) && url.search === location.search;

  function closeMenu(restoreFocus = false) {
    const wasOpen = body.classList.contains("menu-open");
    body.classList.remove("menu-open");
    menu?.setAttribute("aria-expanded", "false");
    menu?.setAttribute("aria-label", "메뉴 열기");
    if (restoreFocus && wasOpen) menu?.focus({preventScroll:true});
  }
  function setCurrent() {
    const headerHeight = header?.getBoundingClientRect().height || 82;
    const marker = headerHeight + Math.min(120,innerHeight * .15);
    let current = null;
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      if (rect.top <= marker && rect.bottom > marker) current = section;
    }
    const route = body.dataset.sitePage === "about" ? "about" : current?.dataset.navSection;
    routes.forEach(link => {
      if (link.dataset.navRoute === route) link.setAttribute("aria-current",body.dataset.sitePage === "about" ? "page" : "location");
      else link.removeAttribute("aria-current");
    });
    document.querySelectorAll(".atelier-section-links a").forEach(link => {
      if (current?.id && (link.dataset.navTarget || link.hash) === `#${current.id}`) link.setAttribute("aria-current","location");
      else link.removeAttribute("aria-current");
    });
  }
  function update() {
    frame = 0;
    body.classList.toggle("has-scrolled",scrollY > 70);
    setCurrent();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  function go(hash,{history=true,focus=true,behavior}={}) {
    let id;
    try { id = decodeURIComponent(hash.replace(/^#/,"")); } catch (_) { return false; }
    const target = document.getElementById(id);
    if (!target) return false;
    closeMenu();
    if (history && location.hash !== hash) window.history.pushState(null,"",hash);
    const headerHeight = header?.getBoundingClientRect().height || 82;
    const top = id === "home" ? 0 : Math.max(0,target.getBoundingClientRect().top + scrollY - headerHeight - 22);
    window.scrollTo({top,behavior:behavior || (id === "home" || reduced.matches ? "instant" : "smooth")});
    if (focus) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex","-1");
      target.classList.add("nav-anchor-target");
      target.focus({preventScroll:true});
    }
    schedule();
    return true;
  }
  window.FormequaNavigation = Object.freeze({go});
  menu?.addEventListener("click",() => {
    const open = body.classList.toggle("menu-open");
    menu.setAttribute("aria-expanded",String(open));
    menu.setAttribute("aria-label",open ? "메뉴 닫기" : "메뉴 열기");
    if (open) requestAnimationFrame(() => requestAnimationFrame(() => {
      if (body.classList.contains("menu-open") && mobile.matches) navigation?.querySelector("a")?.focus({preventScroll:true});
    }));
  });
  document.addEventListener("click",event => {
    const link = event.target.closest?.("a[href]");
    if (link?.closest(".editorial-nav")) closeMenu();
    else if (!event.target.closest?.(".editorial-header")) closeMenu();
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href,location.href);
    if (url.hash && samePage(url) && go(url.hash)) event.preventDefault();
  });
  document.addEventListener("keydown",event => {
    if (!body.classList.contains("menu-open") || !mobile.matches) return;
    if (event.key === "Escape") { event.preventDefault();closeMenu(true);return; }
    if (event.key !== "Tab") return;
    const focusable = [menu,...navigation.querySelectorAll("a[href]")].filter(Boolean);
    const first=focusable[0],last=focusable[focusable.length-1];
    if (event.shiftKey && document.activeElement===first) { event.preventDefault();last.focus(); }
    else if (!event.shiftKey && document.activeElement===last) { event.preventDefault();first.focus(); }
  });
  const restoreHash = () => { if (location.hash) go(location.hash,{history:false,focus:false,behavior:"instant"});else schedule(); };
  addEventListener("popstate",restoreHash);
  addEventListener("hashchange",restoreHash);
  addEventListener("scroll",schedule,{passive:true});
  addEventListener("resize",schedule,{passive:true});
  addEventListener("pageshow",() => {
    if (location.hash === "#home") restoreHash();
    else schedule();
  });
  addEventListener("load",() => requestAnimationFrame(() => requestAnimationFrame(() => {
    // Native initial-fragment scrolling happens after deferred scripts and can
    // otherwise add both scroll-padding and scroll-margin to the destination.
    if (!bootInteraction && originalHash && originalHash === location.hash) restoreHash();
  })),{once:true});
  mobile.addEventListener("change",()=>{closeMenu();schedule();});
  for (const name of ["wheel","pointerdown","keydown","touchstart"]) addEventListener(name,()=>{bootInteraction=true;},{once:true,passive:true});
  function initialize() {
    body.classList.add("site-nav-ready");
    update();
    if (originalHash) go(originalHash,{history:false,focus:false,behavior:"instant"});
    document.fonts?.ready.then(()=>{if (!bootInteraction && originalHash===location.hash && originalHash) restoreHash();});
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded",initialize,{once:true});else initialize();
})();
