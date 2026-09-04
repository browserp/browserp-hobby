import { launchCuration } from "./launch-curation.js";
import { createHash } from "node:crypto";
import { getSession, rpc, uploadStorageObject } from "./supabase.js";
import { fetchMinecraftServer, parseMinecraftAddress } from "./minecraft-import.js";
import { storedServerImage } from "./server-media.js";
import { validatePublicDiscordInvite } from "./discord-claims.js";
import { assertSameOrigin, readBody } from "./http.js";
import { rateLimit } from "./rate-limit.js";
import { assessContent } from "./moderation.js";
import { supabaseConfig } from "./config.js";
import { auditReason, expectedVersion, recordId } from "./claim-workflow.js";

export function minecraftCandidate(source,logoUrl=null){return{
  joinCode:source.sourceKey,address:source.address,edition:source.edition,countScope:"network",gameVersion:source.version,
  name:"",description:"",region:"International",language:"",framework:"Roleplay",accessType:"unknown",
  discordUrl:null,websiteUrl:null,joinUrl:`minecraft://${source.address}`,
  tags:["roleplay",source.edition==="java"?"java edition":"bedrock edition"],keywords:[],logoUrl,bannerUrl:null,
  players:source.players,capacity:source.capacity,online:source.online,checkedAt:source.checkedAt,
  warnings:[{code:"review_editorial",field:"metadata",severity:"warning",message:"Minecraft status establishes the address and aggregate count, not its language, rules, ownership or roleplay quality. Review community sources before publishing."},{code:"count_scope",field:"players",severity:"warning",message:"This count covers the advertised server or network, including any lobby and other worlds. It is not an individual RP-world population."}],
  evidence:[{field:"address",source:"Reviewed Minecraft address",value:source.address,confidence:"high"},{field:"motd",source:"Minecraft status response",value:source.motd,confidence:"medium"},{field:"version",source:"Minecraft status response",value:source.version,confidence:"medium"}],
  sourceUrl:`minecraft://${source.address}?edition=${source.edition}`
};}
async function storeIcon(source){if(!source.icon)return null;const path=`${source.sourceKey}/${createHash("sha256").update(source.icon).digest("hex")}.png`;try{await uploadStorageObject("server-media",path,source.icon,"image/png");}catch(e){if(Number(e.status)!==409)throw e;}return`${supabaseConfig().url}/storage/v1/object/public/server-media/${path}`;}
const EDIT_FIELDS=["name","description","region","language","framework","accessType","discordUrl","websiteUrl","bannerUrl","logoUrl","tags","keywords"];
export async function staffMinecraft(req,res,requestId,{fetchServer=fetchMinecraftServer}={}){
  if(req.method==="POST")assertSameOrigin(req);
  const session=await getSession(req,res,{required:true,provider:"discord"});
  const q=new URL(req.url,"https://browserp.local").searchParams;
  const workspace=await rpc("staff_minecraft_candidates",{p_status:req.method==="GET"?(q.get("status")||"all").slice(0,30):"all",p_query:(q.get("q")||"").slice(0,120),p_limit:req.method==="GET"?25:1,p_offset:req.method==="GET"?Math.min(Math.max(Math.floor(Number(q.get("offset"))||0),0),10000):0},session.accessToken);
  if(req.method==="GET"&&q.get("research")==="true")return{curation:launchCuration("minecraft")};
  if(req.method==="GET")return{workspace:{...workspace,canManage:true}};
  await rateLimit(req,"staff-minecraft",30,300);
  const body=await readBody(req,48*1024);
  if(body.action==="fetch"){
    if(!Array.isArray(body.inputs)||!body.inputs.length||body.inputs.length>3)throw Object.assign(new Error("Fetch up to three reviewed Minecraft addresses per request."),{status:400});
    const edition=body.edition||"java";const inputs=[...new Set(body.inputs.map(v=>{parseMinecraftAddress(v,edition);return String(v).trim();}))];
    const results=await Promise.allSettled(inputs.map(async input=>{const source=await fetchServer(input,{edition});return rpc("service_stage_minecraft_candidate",{p_actor_id:session.user.id,p_candidate:minecraftCandidate(source,await storeIcon(source)),p_request_id:`${requestId}:${source.sourceKey}`},undefined,{useSecret:true});}));
    return{candidates:results.filter(r=>r.status==="fulfilled").map(r=>r.value),errors:results.flatMap((r,i)=>r.status==="rejected"?[{joinCode:inputs[i],message:r.reason?.message||"Minecraft status could not be checked."}]:[])};
  }
  const id=recordId(body.id),reason=auditReason(body.reason),version=expectedVersion(body.expectedVersion);
  if(body.action==="archive")return{result:await rpc("staff_dismiss_minecraft_candidate",{p_id:id,p_expected_version:version,p_reason:reason,p_request_id:requestId},session.accessToken)};
  const entry=await rpc("staff_minecraft_candidate",{p_id:id},session.accessToken);
  if(!entry)throw Object.assign(new Error("This Minecraft candidate is unavailable."),{status:404});
  if(body.action==="refresh"){
    if(!entry.serverId)throw Object.assign(new Error("Publish this reviewed candidate before refreshing its public count."),{status:400});
    const result=await refreshMinecraftCode(entry.joinCode,{serverId:entry.serverId,strict:true,fetchServer});
    return{result,message:result.skipped?"A recent check or another refresh is already in progress. No new observation was fetched; try again in one minute.":"The Minecraft observation was checked."};
  }
  if(body.action!=="publish")throw Object.assign(new Error("Choose a valid Minecraft scraper action."),{status:400});
  if(Number(entry.version)!==version)throw Object.assign(new Error("This candidate changed. Reload before publishing."),{status:409});
  if(!body.data||typeof body.data!=="object"||Array.isArray(body.data))throw Object.assign(new Error("Review the Minecraft details before publishing."),{status:400});
  const data=Object.fromEntries(EDIT_FIELDS.filter(k=>Object.hasOwn(body.data,k)).map(k=>[k,body.data[k]]));const merged={...entry.candidate,...data};
  for(const key of ["logoUrl","bannerUrl"]){if(merged[key]&&!storedServerImage(merged[key]))throw Object.assign(new Error("Use the imported Minecraft icon or a previously approved server image."),{status:400});}
  if(!Array.isArray(merged.tags)||merged.tags.some(t=>typeof t!=="string"))throw Object.assign(new Error("Tags must contain short text labels."),{status:400});
  if(assessContent({name:merged.name,description:merged.description,tags:merged.tags.join(", "),communityUrl:merged.discordUrl,websiteUrl:merged.websiteUrl}).action==="reject")throw Object.assign(new Error("This listing does not meet the content standards."),{status:422});
  if(merged.discordUrl){const invite=await validatePublicDiscordInvite(merged.discordUrl);if(invite.status==="invalid")throw Object.assign(new Error("The Discord invite is invalid. Replace it or clear the field."),{status:422});}
  const source=await fetchServer(entry.candidate.address,{edition:entry.candidate.edition});
  const result=await rpc("staff_publish_minecraft_candidate",{p_id:id,p_expected_version:version,p_data:data,p_reason:reason,p_request_id:requestId},session.accessToken);
  try{await saveObservation(entry.joinCode,source);}
  catch{
    // The audited publication has committed. A separate count write must not invite a duplicate publication retry.
    return{result,warning:"observation_save_failed",message:"Reviewed listing published. Its latest player observation could not be saved; refresh the live player count after one minute."};
  }
  return{result};
}
const saveObservation=(code,source)=>rpc("service_refresh_minecraft_snapshot",{p_join_code:code,p_online:true,p_players:source.players,p_capacity:source.capacity,p_observed_at:source.checkedAt},undefined,{useSecret:true});
export async function refreshMinecraftCode(code,{serverId,strict=false,fetchServer=fetchMinecraftServer}={}){
  if(!/^[a-f0-9]{12}$/.test(code))throw Object.assign(new Error("Invalid Minecraft source."),{status:400});
  recordId(serverId);
  const sources=await rpc("service_minecraft_sources",{p_server_id:serverId,p_due_only:false,p_limit:1},undefined,{useSecret:true});const item=(sources||[]).find(s=>s.serverId===serverId&&s.joinCode===code);
  if(!item)throw Object.assign(new Error("This published Minecraft source is unavailable."),{status:404});
  if(!await rpc("service_claim_minecraft_refresh",{p_join_code:code},undefined,{useSecret:true}))return{serverId,skipped:true,reason:"recent_or_in_progress",checkedAt:item.lastCheckedAt||null};
  try{return await saveObservation(code,await fetchServer(item.address,{edition:item.edition}));}
  catch(e){await rpc("service_mark_minecraft_unavailable",{p_join_code:code},undefined,{useSecret:true});if(strict)throw e;return{players:null,capacity:null,online:false,unavailable:true};}
}
export async function refreshDueMinecraftServers(){
  if(!supabaseConfig().privileged)return[];
  let due;try{due=await rpc("service_minecraft_sources",{p_server_id:null,p_due_only:true,p_limit:3},undefined,{useSecret:true});}catch(e){if(e.code==="PGRST202")return[];throw e;}
  return Promise.allSettled((due||[]).slice(0,3).map(i=>refreshMinecraftCode(i.joinCode,{serverId:i.serverId})));
}
export async function enrichMinecraftServers(servers,{refresh=false}={}){
  const ids=servers.filter(s=>s.platform_id==="minecraft"&&/^[0-9a-f-]{36}$/i.test(s.id||"")).map(s=>s.id).slice(0,100);if(!ids.length)return servers;
  let details;try{details=await rpc("public_minecraft_import_details",{p_server_ids:ids});}catch(e){if(e.code==="PGRST202")return servers;throw e;}
  const updated=new Map();if(refresh&&supabaseConfig().privileged)await Promise.allSettled((details||[]).filter(d=>!d.lastCheckedAt||Date.now()-Date.parse(d.lastCheckedAt)>=60_000).slice(0,3).map(async d=>{const v=await refreshMinecraftCode(d.joinCode,{serverId:d.serverId});if(v&&!v.skipped&&!v.unchanged)updated.set(d.serverId,v);}));
  const byId=new Map((details||[]).map(d=>[d.serverId,d]));
  return servers.map(s=>{const d=byId.get(s.id);if(!d)return s;const live=updated.get(s.id),checkedAt=live?.checkedAt||d.lastCheckedAt,fresh=checkedAt&&Date.now()-Date.parse(checkedAt)<=300000&&(live?!live.unavailable:!d.statusUnavailable);return{...s,imported:true,website_url:d.websiteUrl,logo_url:d.logoUrl,banner_url:d.bannerUrl,keywords:d.keywords||[],minecraft_address:d.address,minecraft_edition:d.edition,count_scope:d.countScope,checked_at:checkedAt,players:fresh?(live?.players??s.players):null,capacity:fresh?(live?.capacity??s.capacity):null,online:fresh?(live?.online??s.online):false};});
}
