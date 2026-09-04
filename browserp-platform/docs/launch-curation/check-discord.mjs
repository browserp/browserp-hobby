import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { validatePublicDiscordInvite } from '../../lib/discord-claims.js';

// Explicit public invite links discovered on a community's own site. No login,
// membership lookup, player information, or guild membership is requested.
const file = new URL('./discord-link-checks.json', import.meta.url);
let records = {}; try { records = JSON.parse(await readFile(file, 'utf8')); } catch {}
for (const url of process.argv.slice(2)) {
  records[url] = { ...(await validatePublicDiscordInvite(url)), checkedAt: new Date().toISOString() };
  console.log(JSON.stringify({ url, ...records[url] }));
  await writeFile(file, JSON.stringify(records, null, 2) + '\n');
  await delay(1100);
}
