import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchFiveMServer, parseFiveMJoinCode } from '../../lib/fivem-import.js';
import { validatePublicDiscordInvite } from '../../lib/discord-claims.js';
// Explicit individually researched join codes only. Never uses a bulk server stream.
const file = new URL('./fivem-live-checks.json', import.meta.url);
let records = {}; try { records = JSON.parse(await readFile(file, 'utf8')); } catch {}
for (const input of process.argv.slice(2)) {
  const code = parseFiveMJoinCode(input);
  try {
    const candidate = await fetchFiveMServer(code, { timeoutMs: 8000 });
    const invite = candidate.links.communityUrl ? await validatePublicDiscordInvite(candidate.links.communityUrl) : null;
    records[code] = { ...candidate, discordCheck: invite, checkedAt: new Date().toISOString() };
    console.log(JSON.stringify({ code, name: candidate.name, language: candidate.language, region: candidate.region, framework: candidate.framework, access: candidate.access, players: candidate.players, links: candidate.links, discord: invite }));
  } catch (error) {
    records[code] = { joinCode: code, error: error.code || error.message, checkedAt: new Date().toISOString() };
    console.log(JSON.stringify(records[code]));
  }
  await writeFile(file, `${JSON.stringify(records, null, 2)}\n`);
  await delay(1100);
}
