document.documentElement.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const revealSelector = [
  ".section-heading",
  ".server-card",
  ".category-card",
  ".credit-card",
  ".tool-card",
  ".feature-list li",
  ".foundation-grid article",
  ".catalog-card",
  ".metric-card",
  ".portal-panel",
  ".detail-card",
  ".legal-copy section"
].join(",");

function wireScrollState() {
  const update = () => document.body.classList.toggle("is-scrolled", window.scrollY > 12);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

function wireReveals() {
  const items = [...document.querySelectorAll(revealSelector)];
  items.forEach((item, index) => {
    item.classList.add("reveal-item");
    item.style.setProperty("--reveal-delay", `${Math.min(index % 5, 4) * 55}ms`);
  });
  if (reduceMotion.matches || !("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("reveal-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("reveal-visible");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
  items.forEach((item) => observer.observe(item));
}

function wireHeroMotion() {
  const visual = document.querySelector(".hero-visual");
  if (!visual || reduceMotion.matches) return;
  let frame = 0;
  visual.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const bounds = visual.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 8;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 8;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      visual.style.setProperty("--pointer-x", `${x.toFixed(2)}px`);
      visual.style.setProperty("--pointer-y", `${y.toFixed(2)}px`);
    });
  });
  visual.addEventListener("pointerleave", () => {
    visual.style.setProperty("--pointer-x", "0px");
    visual.style.setProperty("--pointer-y", "0px");
  });
}

function wireDialogs() {
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function wireResultFeedback() {
  const targets = document.querySelectorAll("#name-results, #hash-results, #server-list, #catalog-grid, #page-content");
  if (!("MutationObserver" in window)) return;
  const observer = new MutationObserver((entries) => {
    for (const entry of entries) {
      const target = entry.target.nodeType === Node.ELEMENT_NODE ? entry.target : entry.target.parentElement;
      if (!target) continue;
      target.classList.remove("interaction-flash");
      requestAnimationFrame(() => target.classList.add("interaction-flash"));
      const added = [...target.querySelectorAll(revealSelector)].filter((item) => !item.classList.contains("reveal-item"));
      added.forEach((item, index) => {
        item.classList.add("reveal-item");
        item.style.setProperty("--reveal-delay", `${Math.min(index, 4) * 45}ms`);
        requestAnimationFrame(() => item.classList.add("reveal-visible"));
      });
    }
  });
  targets.forEach((target) => observer.observe(target, { childList: true, subtree: false }));
}

function wireMotionLifecycle() {
  const update = () => document.body.classList.toggle("motion-paused", document.hidden);
  document.addEventListener("visibilitychange", update);
  update();
}

wireScrollState();
wireReveals();
wireHeroMotion();
wireDialogs();
wireResultFeedback();
wireMotionLifecycle();
