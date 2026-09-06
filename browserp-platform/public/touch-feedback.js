(() => {
  "use strict";

  function touchPolish() {
    const coarse = matchMedia("(hover: none), (pointer: coarse)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const selector = ".button-primary-v3, .button-primary, .small-button-primary";
    let press = null;
    const reset = () => {
      if (!press) return;
      if (press.frame !== null) cancelAnimationFrame(press.frame);
      press.control.classList.remove("touch-sweep-v3");
      press = null;
    };
    const movedAway = (event) => Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
      || event.clientX < press.bounds.left || event.clientX > press.bounds.right
      || event.clientY < press.bounds.top || event.clientY > press.bounds.bottom;
    document.addEventListener("pointerdown", (event) => {
      if (!coarse.matches || reduced.matches || event.pointerType === "mouse" || event.isPrimary === false) return;
      reset();
      const control = event.target.closest(selector);
      if (!control || control.matches(":disabled, [aria-disabled='true']") || control.closest("[inert], #staff-menu-v3, .staff-navigation-toggle, .navigation-toggle-v6, .navigation-close-v6, [data-menu-v3]")) return;
      const current = { control, pointerId: event.pointerId, x: event.clientX, y: event.clientY, bounds: control.getBoundingClientRect(), released: false, frame: null };
      press = current;
      current.frame = requestAnimationFrame(() => {
        current.frame = requestAnimationFrame(() => {
          current.frame = null;
          if (press !== current) return;
          if (!coarse.matches || reduced.matches || !control.isConnected || control.matches(":disabled, [aria-disabled='true']")) { reset(); return; }
          control.classList.add("touch-sweep-v3");
        });
      });
    }, { passive: true });
    document.addEventListener("pointermove", (event) => {
      if (press && !press.released && event.pointerId === press.pointerId && movedAway(event)) reset();
    }, { passive: true });
    document.addEventListener("pointerup", (event) => {
      if (!press || event.pointerId !== press.pointerId) return;
      if (movedAway(event)) reset();
      else press.released = true;
    }, { passive: true });
    document.addEventListener("pointercancel", (event) => {
      if (press && event.pointerId === press.pointerId) reset();
    }, { passive: true });
    document.addEventListener("animationend", (event) => {
      if (event.animationName === "touch-sweep-v3" && press?.control === event.target) reset();
    });
    window.addEventListener("scroll", reset, { passive: true, capture: true });
    window.addEventListener("blur", reset);
    window.addEventListener("pagehide", reset);
    document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
    coarse.addEventListener?.("change", reset);
    reduced.addEventListener?.("change", reset);
  }

  touchPolish();
})();
