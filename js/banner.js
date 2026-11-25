/* Rotating photo banner at the top of the Overview & Leaderboard page (index.html).
   To add a photo: drop it in visuals/, run `python scripts/build_photos.py`,
   then add an entry below (file name in visuals/web/ + caption). */
(function () {
  "use strict";

  const PHOTOS = [
    { file: "euchre-shirts.jpg",          caption: "Euchre Shirts" },
    { file: "greece-euchre.jpg",          caption: "Greece Euchre" },
    { file: "raccoon-motel-winnings.jpg", caption: "Raccoon Motel Winnings" },
    { file: "early-euchre.jpg",           caption: "Early Euchre" },
    { file: "jamboree.jpg",               caption: "Jamboree" },
    { file: "post-raccoon-motel.jpg",     caption: "Post Raccoon Motel" },
    { file: "euchre-facepaint.jpg",       caption: "Euchre Facepaint" },
    { file: "senior-euchre-shirts.jpg",   caption: "Senior Euchre Shirts" },
    { file: "radical-euchre.jpg",         caption: "Radical Euchre" },
  ];
  const BASE = "visuals/web/";
  const INTERVAL_MS = 6000;

  const root = document.getElementById("photo-banner");
  if (!root || PHOTOS.length === 0) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  root.innerHTML = `
    <div class="pb-track">
      ${PHOTOS.map((p, i) => `
        <figure class="pb-slide" aria-hidden="${i === 0 ? "false" : "true"}" data-index="${i}">
          <img class="pb-bg" alt="" data-src="${BASE + p.file}">
          <img class="pb-fg" alt="${p.caption}" data-src="${BASE + p.file}">
          <figcaption>${p.caption}</figcaption>
        </figure>`).join("")}
    </div>
    ${PHOTOS.length > 1 ? `
    <button type="button" class="pb-nav pb-prev" aria-label="Previous photo">&#8249;</button>
    <button type="button" class="pb-nav pb-next" aria-label="Next photo">&#8250;</button>
    <div class="pb-dots" role="group" aria-label="Choose photo">
      ${PHOTOS.map((p, i) => `<button type="button" class="pb-dot" aria-label="Show photo ${i + 1}: ${p.caption}" data-index="${i}"></button>`).join("")}
    </div>` : ""}`;

  const slides = [...root.querySelectorAll(".pb-slide")];
  const dots = [...root.querySelectorAll(".pb-dot")];
  let current = 0, timer = null, paused = false;

  // load a slide's images only when it's about to be shown
  function load(i) {
    slides[i].querySelectorAll("img[data-src]").forEach((img) => {
      img.src = img.dataset.src;
      img.removeAttribute("data-src");
    });
  }

  function show(i) {
    current = (i + slides.length) % slides.length;
    load(current);
    load((current + 1) % slides.length); // preload the next one
    slides.forEach((s, j) => {
      s.classList.toggle("active", j === current);
      s.setAttribute("aria-hidden", j === current ? "false" : "true");
    });
    dots.forEach((d, j) => d.setAttribute("aria-current", j === current ? "true" : "false"));
  }

  function schedule() {
    clearInterval(timer);
    if (reduceMotion || paused || slides.length < 2) return;
    timer = setInterval(() => show(current + 1), INTERVAL_MS);
  }

  // manual navigation restarts the countdown so a slide isn't skipped instantly
  root.querySelector(".pb-prev")?.addEventListener("click", () => { show(current - 1); schedule(); });
  root.querySelector(".pb-next")?.addEventListener("click", () => { show(current + 1); schedule(); });
  dots.forEach((d) => d.addEventListener("click", () => { show(parseInt(d.dataset.index, 10)); schedule(); }));

  // pause while hovered/focused or while the tab is in the background
  const pause = () => { paused = true; schedule(); };
  const resume = () => { paused = false; schedule(); };
  root.addEventListener("mouseenter", pause);
  root.addEventListener("mouseleave", resume);
  root.addEventListener("focusin", pause);
  root.addEventListener("focusout", resume);
  document.addEventListener("visibilitychange", () => (document.hidden ? pause() : resume()));

  // swipe on touch screens
  let touchX = null;
  root.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  root.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) { show(current + (dx < 0 ? 1 : -1)); schedule(); }
    touchX = null;
  });

  show(0);
  schedule();
})();
