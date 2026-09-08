// Rasterize the existing artwork and its fixed filter once per size/DPR. Each
// frame then composites cached strips into one viewport-sized decorative layer.
const fraction = value => value - Math.floor(value);
const ease = progress => {
  let low = 0, high = 1;
  for (let i = 0; i < 20; i += 1) {
    const t = (low + high) / 2, inverse = 1 - t;
    const x = 3 * inverse * inverse * t * .42 + 3 * inverse * t * t * .58 + t * t * t;
    if (x < progress) low = t; else high = t;
  }
  const t = (low + high) / 2;
  return 3 * t * t - 2 * t * t * t;
};

export function wordmarkMotion(geometry, milliseconds, reduced = false) {
  const time = milliseconds / 1000, { rows, width, period, tempo, waveStart, waveDuration, waveOpacity, waveScale } = geometry;
  const travel = reduced ? 0 : width * fraction(time / period);
  return {
    time: milliseconds,
    planeX: 0,
    rows: Array.from({ length: rows }, (_, index) => {
      const local = time - ((index - waveStart) * .32 - .9) * tempo;
      const phase = fraction(local / (waveDuration * tempo));
      const wave = reduced || local < 0 || phase >= .14 ? 0 : ease(phase <= .07 ? phase / .07 : (.14 - phase) / .07);
      return { x: travel, opacity: waveOpacity * wave, scale: 1 + (waveScale - 1) * wave };
    })
  };
}

const loadedImage = source => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = source;
});

async function strips(image, geometry) {
  const { extent, height, width, dpr } = geometry, padding = 8;
  const base = document.createElement('canvas');
  base.width = Math.ceil((extent + width * 2) * dpr);
  base.height = Math.ceil(height * dpr);
  const context = base.getContext('2d');
  context.scale(dpr, dpr);
  context.beginPath(); context.rect(0, 0, extent + width * 2, height); context.clip();
  for (let x = 0; x < extent + width * 2; x += width) context.drawImage(image, x, 0, width, height);

  const glow = document.createElement('canvas');
  glow.width = base.width + Math.ceil(padding * dpr) * 2;
  glow.height = base.height + Math.ceil(padding * dpr) * 2;
  const pad = Math.ceil(padding * dpr) / dpr;
  // SVG filter support includes browsers without CanvasRenderingContext2D.filter.
  // Explicit sRGB matches CSS brightness; rasterize this SVG only once, rather
  // than applying a filter to every repeated row on every animation frame.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${glow.width}" height="${glow.height}" viewBox="0 0 ${glow.width / dpr} ${glow.height / dpr}"><defs><filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="1.12"/><feFuncG type="linear" slope="1.12"/><feFuncB type="linear" slope="1.12"/></feComponentTransfer><feDropShadow dx="0" dy="0" stdDeviation="1" flood-color="rgb(236,79,166)" flood-opacity=".32"/></filter></defs><image x="${pad}" y="${pad}" width="${base.width / dpr}" height="${base.height / dpr}" href="${base.toDataURL()}" filter="url(#glow)"/></svg>`;
  // data: images already satisfy the site's restrictive image CSP; blob: does
  // not, and is unnecessary for this small, self-contained preparation image.
  glow.getContext('2d').drawImage(await loadedImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`), 0, 0);
  return { base, glow, pad };
}

export function createWordmarkCanvas(pattern, plane) {
  const canvas = document.createElement('canvas');
  canvas.className = 'home-hero-wordmark-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return null;
  let geometry, textures, image, pendingSize = '', build = 0, disposed = false;
  let running = false, reduced = false, request = 0, elapsed = 0, last = null;
  const paint = () => {
    if (!geometry || !textures) return;
    const { dpr, viewportWidth, viewportHeight, extent, planeHeight, width, height, pitch, baseOpacity } = geometry;
    const frame = wordmarkMotion(geometry, elapsed, reduced);
    // Read-only frame data lets visual QA inspect the actual drawn state.
    canvas.wordmarkFrame = { ...frame, geometry: { ...geometry } };
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, viewportWidth, viewportHeight);
    context.translate(viewportWidth / 2, viewportHeight / 2);
    context.rotate(-Math.PI / 4);
    context.translate(-extent / 2 + frame.planeX, -planeHeight / 2);
    const visibleHalfHeight = (viewportWidth + viewportHeight) / Math.SQRT2 / 2;
    for (let i = 0; i < frame.rows.length; i += 1) {
      const top = i * pitch, row = frame.rows[i];
      if (top + height + 9 < planeHeight / 2 - visibleHalfHeight || top - 9 > planeHeight / 2 + visibleHalfHeight) continue;
      context.save(); context.translate(row.x - width, top);
      context.globalAlpha = baseOpacity;
      context.drawImage(textures.base, 0, 0, textures.base.width / dpr, textures.base.height / dpr);
      if (row.opacity > 0) {
        context.globalAlpha = row.opacity;
        context.translate(0, height / 2); context.scale(1, row.scale);
        context.drawImage(textures.glow, -textures.pad, -height / 2 - textures.pad, textures.glow.width / dpr, textures.glow.height / dpr);
      }
      context.restore();
    }
  };
  const tick = now => {
    request = 0;
    if (disposed || !running || !textures) return;
    if (last !== null) elapsed += now - last;
    last = now; paint(); request = requestAnimationFrame(tick);
  };
  const setMotion = (active, prefersReduced) => {
    const changed = reduced !== prefersReduced;
    running = active; reduced = prefersReduced;
    if (!running) { cancelAnimationFrame(request); request = 0; last = null; }
    else if (textures && !request) request = requestAnimationFrame(tick);
    if (changed || !running) paint();
  };
  const resize = async () => {
    if (!image || disposed) return;
    const rect = pattern.getBoundingClientRect(), style = getComputedStyle(pattern), planeStyle = getComputedStyle(plane);
    const row = plane.firstElementChild;
    if (!row || !rect.width || !rect.height) return;
    const width = parseFloat(style.getPropertyValue('--wordmark-width')) || 92;
    const height = parseFloat(getComputedStyle(row).height) || width * image.naturalHeight / image.naturalWidth;
    const next = { viewportWidth: rect.width, viewportHeight: rect.height, extent: parseFloat(plane.style.width), width, height,
      pitch: height + (parseFloat(style.getPropertyValue('--wordmark-gap')) || 16),
      planeHeight: parseFloat(planeStyle.height), rows: plane.children.length,
      tempo: parseFloat(style.getPropertyValue('--wordmark-tempo')) || 1.3333333333,
      period: parseFloat(style.getPropertyValue('--wordmark-period')) || 36.8,
      baseOpacity: parseFloat(style.getPropertyValue('--wordmark-base-opacity')) || .07,
      waveOpacity: parseFloat(style.getPropertyValue('--wordmark-wave-opacity')) || .24,
      waveScale: parseFloat(style.getPropertyValue('--wordmark-wave-scale')) || 1.03,
      waveStart: parseFloat(plane.style.getPropertyValue('--wave-start')) || 0,
      waveDuration: parseFloat(plane.style.getPropertyValue('--wave-duration')) || 18,
      dpr: window.devicePixelRatio || 1 };
    const key = JSON.stringify(next);
    if (key === pendingSize) return;
    pendingSize = key; const generation = ++build;
    try {
      const prepared = await strips(image, next);
      if (disposed || generation !== build) return;
      if (!textures) elapsed = Number(plane.getAnimations?.({ subtree: true })[0]?.currentTime) || 0;
      geometry = next; textures = prepared;
      canvas.width = Math.ceil(next.viewportWidth * next.dpr); canvas.height = Math.ceil(next.viewportHeight * next.dpr);
      if (!canvas.isConnected) pattern.append(canvas);
      pattern.dataset.renderer = 'canvas';
      paint();
      if (running && !request) request = requestAnimationFrame(tick);
    } catch {
      if (disposed || generation !== build) return;
      pendingSize = ''; textures = null;
      cancelAnimationFrame(request); request = 0; last = null;
      canvas.remove(); delete pattern.dataset.renderer;
      // A later resize can fail too. Restore the responsive CSS fallback and
      // its saved phase rather than leaving an old bitmap stretched onscreen.
      for (const animation of plane.getAnimations?.({ subtree: true }) || []) animation.currentTime = elapsed;
    }
  };
  const source = getComputedStyle(plane.firstElementChild, '::before').backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
  if (source) loadedImage(source).then(value => { image = value; return resize(); }).catch(() => {});
  return { resize, setMotion, destroy() {
    disposed = true; build += 1; cancelAnimationFrame(request); canvas.remove();
    delete pattern.dataset.renderer; textures = null;
  } };
}
