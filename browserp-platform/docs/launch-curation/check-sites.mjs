import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const file = new URL('./official-site-checks.json', import.meta.url);
let records = {}; try { records = JSON.parse(await readFile(file, 'utf8')); } catch {}
for(const input of process.argv.slice(2)) {
 const url=new URL(input);if(url.protocol!=='https:')throw new Error('HTTPS required');
 try {
  const response=await fetch(url,{signal:AbortSignal.timeout(9000),headers:{accept:'text/html'}});
  const raw=(await response.text()).slice(0,2_000_000);
  const links=[...new Set([...raw.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map(m=>m[1]).filter(h=>/cfx|discord|rule|whitelist|apply|join|guide|connect|logo|changelog|faq|about|\.js(?:\?|$)/i.test(h)).map(h=>{try{return new URL(h,response.url).href}catch{return null}}).filter(Boolean))].slice(0,80);
  const directCodes=[...new Set([...raw.matchAll(/cfx\.re(?:\\\/|\/)join(?:\\\/|\/)([a-z0-9]{6,12})/gi)].map(m=>m[1]))];
  records[input]={url:response.url,status:response.status,title:raw.match(/<title[^>]*>([^<]+)/i)?.[1]||null,links,directCodes,checkedAt:new Date().toISOString()};
 }catch(error){records[input]={error:error.message,checkedAt:new Date().toISOString()};}
 console.log(JSON.stringify({source:input,...records[input]}));
 await writeFile(file,JSON.stringify(records,null,2)+'\n');await delay(500);
}
