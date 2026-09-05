import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRobloxUrl, robloxApplication } from "../lib/roblox-application.js";
import { enrichRobloxApplications, publicRobloxDetails } from "../lib/roblox-listings.js";
const rb={kind:"independent_community",experienceUrl:"https://www.roblox.com/games/12345",communityGroupUrl:null,joiningInstructions:"Join the community through its official Discord and read the rules before an organised session.",applicantRole:"Community owner",authorityEvidence:"I can add a temporary public reference to the official community property to demonstrate control."};
test("Roblox URL parser distinguishes public experience/group pages from lookalikes and private access",()=>{
 assert.equal(canonicalRobloxUrl("https://roblox.com/games/12345/Friendly-Roleplay"),rb.experienceUrl);
 assert.equal(canonicalRobloxUrl("https://www.roblox.com/groups/25/Community","community"),"https://www.roblox.com/communities/25");
 for(const url of ["https://roblox.com.evil/games/123", "https://evil@roblox.com/games/123", "http://roblox.com/games/123", "https://roblox.com:8080/games/123", "https://roblox.com:443/games/123", "https://roblox.com/games/123?", "https://roblox.com/games/123?privateServerLinkCode=secret", "https://roblox.com/share?code=secret", "https://roblox.com/games/123#", "https://discord.gg/roblox", "https://roblox.com/communities/123", "https://roblox.com/games/0"])assert.throws(()=>canonicalRobloxUrl(url));
 assert.throws(()=>canonicalRobloxUrl(rb.experienceUrl,"community"));
 assert.equal(robloxApplication(null,"fivem","vMenu","https://discord.gg/example"),null);
 assert.throws(()=>robloxApplication(rb,"fivem","vMenu","https://discord.gg/example"));
 assert.throws(()=>robloxApplication({...rb,playerCount:4000},"roblox","Experience","https://discord.gg/example"));
});
test("public Roblox projection strips authority evidence and unknown/count fields",()=>{
 assert.deepEqual(publicRobloxDetails({...rb,players:10000,applicantRole:"Private",authorityEvidence:"Private"}),{kind:rb.kind,experienceUrl:rb.experienceUrl,communityGroupUrl:null,joiningInstructions:rb.joiningInstructions});
 assert.equal(publicRobloxDetails({...rb,experienceUrl:"javascript:alert(1)"}),null);
});
test("Roblox enrichment never presents experience totals as community activity and preserves other games",async t=>{
 const original=globalThis.fetch, prior={...process.env};t.after(()=>{globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];Object.assign(process.env,prior);});
 Object.assign(process.env,{SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture"});
 let requested;globalThis.fetch=async(url,options)=>{requested={url,options,body:JSON.parse(options.body)};return new Response(JSON.stringify([{id:"00000000-0000-4000-8000-000000000001",roblox:{...rb,authorityEvidence:"Private"}}]),{headers:{"Content-Type":"application/json"}});};
 const fivem={id:"00000000-0000-4000-8000-000000000002",platform_id:"fivem",players:50,online:true};
 const result=await enrichRobloxApplications([{id:"00000000-0000-4000-8000-000000000001",platform_id:"roblox",players:10000,online:true,capacity:12000,uptime:99},fivem]);
 assert.equal(result[0].players,null);assert.equal(result[0].online,false);assert.equal(result[0].uptime,null);assert.equal(result[0].applicationOnly,true);assert.equal(result[0].roblox.authorityEvidence,undefined);assert.equal(result[1],fivem);assert.deepEqual(requested.body.p_server_ids,[result[0].id]);assert.equal(requested.options.headers.apikey,"sb_publishable_fixture");
 requested=null;assert.deepEqual(await enrichRobloxApplications([fivem]),[fivem]);assert.equal(requested,null);
});
