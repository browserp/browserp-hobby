import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
const between = (text, from, to) => { const start = text.indexOf(from), end = text.indexOf(to, start); assert.ok(start >= 0 && end > start); return text.slice(start, end); };
const server = { slug: 'community-test', name: 'Community Test', platform_id: 'fivem', region: 'United Kingdom', language: 'French', framework: 'QBCore', access_type: 'allowlisted', description: 'A community built around long-running character stories.', logo_url: '/approved-logo.png', banner_url: '/approved-banner.webp', pending_logo_url: '/unreviewed.png', tags: ['police rp', 'custom cars', 'serious rp', 'events'], online: true, players: 41, capacity: 100 };
function fixture(t, kind) {
  const dom = new JSDOM('<main></main>', { url: 'https://browserp.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const w = dom.window; w.eval(read('browserp-platforms.js'));
  const source = read(kind === 'directory' ? 'browserp-directory.js' : 'browserp-games.js');
  const functions = kind === 'directory'
    ? between(source, '  function initials(', '  function serverSkeletonCard(') + between(source, '  function serverCard(', '  function renderServers(')
    : source.split('\n').find(line => line.startsWith('  const node = ')) + '\n' + between(source, '  function serverCard(', '  function render(');
  w.eval(`(() => { ${functions}; window.renderCard = serverCard; })();`);
  return { w, render(values = server) { const card = w.renderCard(values); w.document.querySelector('main').replaceChildren(card); return card; } };
}
for (const kind of ['directory', 'game']) {
  test(`${kind} card shows approved logo, then banner on error, then initials without image overlay badges`, t => {
    const h = fixture(t, kind), card = h.render(); let image = card.querySelector('img');
    assert.equal(image.getAttribute('src'), '/approved-logo.png'); assert.equal(image.alt, '');
    assert.equal(image.loading, 'lazy'); assert.equal(card.querySelector('.server-card-media-fallback'), null);
    image.dispatchEvent(new h.w.Event('error')); assert.equal(image.getAttribute('src'), '/approved-banner.webp');
    image.dispatchEvent(new h.w.Event('error')); assert.equal(card.querySelector('img'), null); assert.equal(card.querySelector('.server-initials').textContent, 'CT');
    const missingLogo = h.render({ ...server, logo_url: '' }); assert.equal(missingLogo.querySelector('img').getAttribute('src'), '/approved-banner.webp');
    const duplicate = h.render({ ...server, banner_url: server.logo_url }); duplicate.querySelector('img').dispatchEvent(new h.w.Event('error')); assert.equal(duplicate.querySelector('img'), null);
    const missing = h.render({ ...server, logo_url: '', banner_url: '' }); assert.equal(missing.querySelector('img'), null); assert.equal(missing.querySelector('.server-initials').textContent, 'CT');
  });
  test(`${kind} card keeps the first three feature cues and metadata order without feature counts`, t => {
    const h = fixture(t, kind), card = h.render();
    assert.deepEqual([...card.querySelectorAll('.server-tags > span')].map(n => n.textContent), server.tags.slice(0, 3));
    assert.equal(card.querySelector('.server-description').nextElementSibling.className, 'server-tags');
    assert.equal(card.querySelector('.server-tags').nextElementSibling.className, 'server-card-bottom');
    assert.deepEqual([...card.querySelector('.platform-meta-v5').children].map(n => n.getAttribute('aria-label')), ['Game: FiveM', 'Region: United Kingdom', 'Language: French', 'Server setup: QBCore', 'Access: Approval required']);
    const escaped = h.render({ ...server, tags: ['<img src=x onerror=bad()>'], logo_url: 'javascript:bad()', banner_url: '//untrusted.example/image.png' });
    assert.equal(escaped.querySelector('.server-tags img'), null); assert.equal(escaped.querySelector('.server-tags').textContent, '<img src=x onerror=bad()>'); assert.equal(escaped.querySelector('.server-card-media img'), null);
    assert.equal(h.render({ ...server, tags: null }).querySelector('.server-tags').children.length, 0);
  });
  test(`${kind} Roblox card uses Community listing and never implies a measured live count`, t => {
    const card = fixture(t, kind).render({ ...server, platform_id: 'roblox', framework: 'Emergency experience', applicationOnly: true });
    assert.equal(card.querySelector('.status').textContent, 'Community listing'); assert.equal(card.querySelector('.status').classList.contains('online'), false);
    assert.equal(card.querySelector('.server-card-bottom strong').textContent, 'Live player count not provided');
  });
}
test('public and staff controller documents load the same standalone touch helper once', () => {
  for (const file of readdirSync(new URL('../public', import.meta.url)).filter(name => name.endsWith('.html') && name !== 'index.html')) {
    const html = read(file); if (!/\/(?:browserp|staffpanel)-v3\.js\?/.test(html)) continue;
    assert.equal((html.match(/src="\/touch-feedback\.js\?v=[0-9.]+"/g) || []).length, 1, file);
    assert.ok(html.indexOf('/touch-feedback.js') < html.search(/src="\/(?:browserp|staffpanel)-v3\.js/), file);
    if (file.startsWith('staffpanel')) assert.doesNotMatch(html, /src="\/browserp-v3\.js/);
  }
});
