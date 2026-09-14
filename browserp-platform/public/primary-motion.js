(() => {
  "use strict";

  // CSS owns the colour and light. This only eases the existing colour clock's
  // speed, preserving its position when the pointer enters, leaves or returns.
  if (!Element.prototype.getAnimations) return;
  const selector = ".button-primary-v3,.button-primary,.small-button-primary,.ds-button-primary";
  const unavailable = ":disabled,[aria-disabled='true'],[aria-pressed='true'],[aria-busy='true']";
  const motion = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)");
  const controls = new Set();
  const ramps = new Map();
  let suspended = document.hidden;

  function stop(control) {
    const ramp = ramps.get(control);
    if (!ramp) return;
    cancelAnimationFrame(ramp.frame);
    ramps.delete(control);
  }

  function refresh(control) {
    if (!controls.has(control)) return;
    const previous = ramps.get(control);
    const animation = control.getAnimations().find(item => item.animationName === "primary-colour-drift");
    if (!animation?.updatePlaybackRate) { stop(control); return; }
    const eligible = motion.matches && !suspended && control.isConnected
      && control.dataset.primaryMotion !== "paused" && !control.matches(unavailable);
    if (!eligible) { stop(control); animation.updatePlaybackRate(1); return; }
    const target = control.matches(":hover,:focus-visible") ? 2.4 : 1;
    if (previous?.animation === animation && previous.target === target) return;
    const from = previous?.animation === animation ? previous.rate : animation.playbackRate;
    stop(control);
    if (Math.abs(from - target) < .001) return;
    const started = performance.now();
    const duration = target > from ? 480 : 650;
    const ramp = { animation, target, rate: from, frame: null };
    ramps.set(control, ramp);
    function step(now) {
      if (suspended || !motion.matches || !control.isConnected || control.matches(unavailable)
        || control.dataset.primaryMotion === "paused" || animation.playState === "idle") {
        stop(control); animation.updatePlaybackRate(1); return;
      }
      const progress = Math.min(1, (now - started) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      ramp.rate = from + (target - from) * eased;
      animation.updatePlaybackRate(ramp.rate);
      if (progress < 1) ramp.frame = requestAnimationFrame(step);
      else ramps.delete(control);
    }
    ramp.frame = requestAnimationFrame(step);
  }

  const visibility = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      entry.target.dataset.primaryMotion = entry.isIntersecting ? "visible" : "paused";
      refresh(entry.target);
    }
  }) : null;

  function register(control) {
    if (controls.has(control)) { refresh(control); return; }
    controls.add(control);
    control.dataset.primaryMotion = visibility ? "paused" : "visible";
    if (visibility) visibility.observe(control);
    else refresh(control);
  }
  function discover(root) {
    if (!(root instanceof Element)) return;
    if (root.matches(selector)) register(root);
    root.querySelectorAll(selector).forEach(register);
  }
  discover(document.body);
  new MutationObserver(records => {
    for (const control of controls) {
      if (!control.isConnected || !control.matches(selector)) {
        stop(control); visibility?.unobserve(control); controls.delete(control);
        delete control.dataset.primaryMotion;
      }
    }
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach(discover);
      else if (record.target.matches(selector)) register(record.target);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["class", "disabled", "aria-disabled", "aria-pressed", "aria-busy"] });

  for (const type of ["pointerover", "pointerout", "focusin", "focusout"]) {
    document.addEventListener(type, event => {
      if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const control = event.target.closest?.(selector);
      if (!control || (event.relatedTarget instanceof Node && control.contains(event.relatedTarget))) return;
      refresh(control);
    }, { passive: true });
  }
  function suspend(value) {
    suspended = value;
    document.documentElement.dataset.primaryMotion = value ? "paused" : "visible";
    controls.forEach(refresh);
  }
  motion.addEventListener("change", () => controls.forEach(refresh));
  document.addEventListener("visibilitychange", () => suspend(document.hidden));
  window.addEventListener("pagehide", () => suspend(true));
  window.addEventListener("pageshow", () => suspend(document.hidden));
  window.addEventListener("blur", () => suspend(true));
  window.addEventListener("focus", () => suspend(document.hidden));
  suspend(document.hidden);
})();
