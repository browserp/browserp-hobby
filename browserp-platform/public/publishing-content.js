(() => {
  "use strict";

  const ORIGIN = "https://www.browserp.com";
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  // This labelled-link subset is shared by staff preview, public enhancement and initial HTML.
  function articleLink(value) {
    if (typeof value !== "string" || value.length > 2048 || /[\s\\<>"`\u0000-\u001f\u007f]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return null;
    const local = /^\/(?!\/)/.test(value);
    if (!local && !/^https:\/\/[^/]/i.test(value)) return null;
    try {
      const url = new URL(value, ORIGIN);
      if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
      if (local) return url.origin === ORIGIN ? url.pathname + url.search + url.hash : null;
      const authority = value.slice(value.indexOf("//") + 2).split(/[/?#]/)[0];
      if (authority.includes("@")) return null;
      const labels = url.hostname.split(".");
      if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
      if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(labels.at(-1)) || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|test|invalid|example|onion)$/i.test(url.hostname)) return null;
      return url.href;
    } catch { return null; }
  }
  function inlineParts(text, literal = false) {
    if (literal) return [{ text }];
    const parts = []; const pattern = /`+|\[([^\]\r\n]{1,200})\]\(([^()\s]{1,2048})\)/g;
    let cursor = 0, match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
      if (match[0].startsWith("`")) {
        const end = text.indexOf(match[0], pattern.lastIndex);
        const until = end < 0 ? text.length : end + match[0].length;
        parts.push({ text: text.slice(match.index, until) }); pattern.lastIndex = until;
      } else {
        const href = /[!\\]/.test(text[match.index - 1] || "") ? null : articleLink(match[2]);
        parts.push(href ? { text: match[1], href } : { text: match[0] });
      }
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor) });
    return parts;
  }
  // Fences and inline code stay literal; this is not an HTML or full Markdown editor.
  function articleBlocks(body) {
    const blocks = []; let lines = [], fence = null;
    function flush(literal = false) {
      const text = lines.join("\n").trim(); lines = []; if (!text) return;
      const heading = !literal && text.match(/^(#{1,3})\s+(.+)$/);
      if (heading) blocks.push({ tag: heading[1].length === 3 ? "h3" : "h2", parts: inlineParts(heading[2]) });
      else if (!literal && text.split("\n").every(line => /^[-*]\s+/.test(line))) blocks.push({ tag: "ul", items: text.split("\n").map(line => inlineParts(line.replace(/^[-*]\s+/, ""))) });
      else blocks.push({ tag: "p", parts: inlineParts(text.replace(/\n/g, " "), literal) });
    }
    for (const line of String(body || "").replace(/\r\n?/g, "\n").split("\n")) {
      if (fence) {
        lines.push(line);
        if (new RegExp(`^ {0,3}${fence.mark}{${fence.length},}\\s*$`).test(line)) { flush(true); fence = null; }
        continue;
      }
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) { flush(); fence = { mark: opening[1][0], length: opening[1].length }; lines.push(line); }
      else if (!line.trim()) flush(); else lines.push(line);
    }
    flush(Boolean(fence)); return blocks;
  }
  function renderArticle(root, body) {
    const fragment = document.createDocumentFragment();
    const appendParts = (parent, parts) => parts.forEach(part => {
      if (!part.href) { parent.append(document.createTextNode(part.text)); return; }
      const link = document.createElement("a"); link.textContent = part.text; link.setAttribute("href", part.href); link.rel = "noopener noreferrer"; parent.append(link);
    });
    for (const block of articleBlocks(body)) {
      const element = document.createElement(block.tag);
      if (block.items) block.items.forEach(parts => { const item = document.createElement("li"); appendParts(item, parts); element.append(item); });
      else appendParts(element, block.parts);
      fragment.append(element);
    }
    root.replaceChildren(fragment);
  }
  function articleHTML(body) {
    const inline = parts => parts.map(part => part.href ? `<a href="${escapeHTML(part.href)}" rel="noopener noreferrer">${escapeHTML(part.text)}</a>` : escapeHTML(part.text)).join("");
    return articleBlocks(body).map(block => `<${block.tag}>${block.items ? block.items.map(parts => `<li>${inline(parts)}</li>`).join("") : inline(block.parts)}</${block.tag}>`).join("");
  }

  async function importArticle(file) {
    if (!file || !/\.(md|txt)$/i.test(file.name || "") || !["", "text/plain", "text/markdown", "text/x-markdown"].includes(file.type || "")) {
      throw new Error("Choose a Markdown (.md) or plain text (.txt) file.");
    }
    if (file.size > 64 * 1024) throw new Error("The file must be 64 KB or smaller.");
    const body = (await file.text()).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!body || body.length > 20000) throw new Error("The article must contain between 1 and 20,000 characters.");
    if (/<\/?[a-z][^>]*>/i.test(body) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) {
      throw new Error("Use plain text or Markdown without HTML or embedded files.");
    }
    return body;
  }

  function slugify(title) {
    return String(title || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160).replace(/-+$/g, "");
  }

  const content = Object.freeze({ renderArticle, articleHTML, articleLink, importArticle, slugify });
  if (typeof window !== "undefined") window.BrowseRPContent = content;
  else globalThis.BrowseRPContent = content;
})();
