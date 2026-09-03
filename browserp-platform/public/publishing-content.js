(() => {
  "use strict";

  function renderArticle(root, body) {
    const fragment = document.createDocumentFragment();
    const appendText = (tag, text, parent = fragment) => {
      const element = document.createElement(tag);
      element.textContent = text;
      parent.append(element);
      return element;
    };
    String(body || "").replace(/\r\n?/g, "\n").split(/\n{2,}/).forEach((block) => {
      const text = block.trim();
      if (!text) return;
      const heading = text.match(/^(#{1,3})\s+(.+)$/);
      if (heading) appendText(heading[1].length === 3 ? "h3" : "h2", heading[2]);
      else if (text.split("\n").every((line) => /^[-*]\s+/.test(line))) {
        const list = document.createElement("ul");
        text.split("\n").forEach((line) => appendText("li", line.replace(/^[-*]\s+/, ""), list));
        fragment.append(list);
      } else appendText("p", text.replace(/\n/g, " "));
    });
    root.replaceChildren(fragment);
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

  window.BrowseRPContent = Object.freeze({ renderArticle, importArticle, slugify });
})();
