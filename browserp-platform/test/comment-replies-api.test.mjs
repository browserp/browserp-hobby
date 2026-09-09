import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/servers.js';
const userId='00000000-0000-4000-8000-000000000001', serverId='11111111-0000-4000-8000-000000000001', parentId='22222222-0000-4000-8000-000000000002';
const csrf='c'.repeat(43),token=`fixture.${Buffer.from(JSON.stringify({sub:userId})).toString('base64url')}.fixture`;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const request=body=>({method:'POST',url:'/api/servers',body:{action:'comment',serverId,body:'A thoughtful reply to this community.',...body},headers:{host:'localhost:8080',origin:'http://localhost:8080','content-type':'application/json','x-browserp-csrf':csrf,cookie:`brp_access=${token}; brp_csrf=${csrf}`},socket:{remoteAddress:'127.0.0.1'}});
function output(){const headers=new Map();return{setHeader:(k,v)=>headers.set(k,v),getHeader:k=>headers.get(k),end(value){this.payload=JSON.parse(value);}};}
async function fixture(run,replyStatus=200){
 const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture',APP_URL:'http://localhost:8080',NODE_ENV:'test',VERCEL:'0',PRIVACY_HASH_SECRET:'fixture-secret'};
 const previous=new Map(Object.keys(env).map(k=>[k,process.env[k]])),original=globalThis.fetch,calls=[];Object.assign(process.env,env);
 globalThis.fetch=async(value,options={})=>{const path=new URL(value).pathname,body=options.body?JSON.parse(options.body):null;calls.push({path,body,options});
  if(path==='/auth/v1/user')return json({id:userId,app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google'}]});
  if(path.endsWith('/check_security_ban_server'))return json(null);
  if(path.endsWith('/consume_rate_limit'))return json(true);
  if(path.endsWith('/member_server_comment_reply'))return replyStatus===200?json({id:'new-reply',status:'pending_review',parentCommentId:body.p_parent_comment_id}):json({message:'This comment is unavailable for replies.',code:'PT404'},replyStatus);
  if(path.endsWith('/member_server_interaction'))return json({id:'new-comment',status:'pending_review'});
  if(path.endsWith('/member_content_moderation_item'))return json({id:'33333333-0000-4000-8000-000000000003',kind:'comment',targetId:body.p_target||'new-comment',status:'pending_review',version:1});
  if(path.endsWith('/service_content_check_input'))return json(null);
  throw Error('Unexpected fixture route '+path);
 };try{await run(calls);}finally{globalThis.fetch=original;for(const[k,v]of previous)v===undefined?delete process.env[k]:process.env[k]=v;}
}
test('reply route passes only validated parent and moderated body under the current member token',async()=>fixture(async calls=>{
 const out=output();await handler(request({parentCommentId:parentId,badges:[{kind:'staff'}],author:'Spoofed staff',editedAt:'2020-01-01'}),out);
 assert.equal(out.statusCode,201,out.payload.error);assert.equal(out.payload.result.status,'pending_review');
 const write=calls.find(c=>c.path.endsWith('/member_server_comment_reply'));assert.deepEqual(write.body,{p_server_id:serverId,p_parent_comment_id:parentId,p_body:'A thoughtful reply to this community.'});
 assert.equal(write.options.headers.Authorization,`Bearer ${token}`);assert.equal(write.options.headers.apikey,'sb_publishable_fixture');
 assert.equal(calls.some(c=>c.path.endsWith('/member_server_interaction')),false);
}));
test('ordinary comments retain the original interaction contract',async()=>fixture(async calls=>{
 const out=output();await handler(request({}),out);assert.equal(out.statusCode,201,out.payload.error);
 assert.equal(calls.filter(c=>c.path.endsWith('/member_server_interaction')).length,1);assert.equal(calls.some(c=>c.path.endsWith('/member_server_comment_reply')),false);
}));
test('malformed or inapplicable reply targets and foreign origins cannot write',async()=>fixture(async calls=>{
 for(const body of [{parentCommentId:''},{parentCommentId:{id:parentId}},{parentCommentId:'nope'},{action:'vote',parentCommentId:parentId}]){const out=output();await handler(request(body),out);assert.equal(out.statusCode,400);}
 const req=request({parentCommentId:parentId});req.headers.origin='https://other.example';const out=output();await handler(req,out);assert.equal(out.statusCode,403);
 assert.equal(calls.some(c=>/member_server_(?:interaction|comment_reply)$/.test(c.path)),false);
}));
test('a parent hidden after rendering returns an error rather than a false published reply',async()=>fixture(async()=>{
 const out=output();await handler(request({parentCommentId:parentId}),out);assert.equal(out.statusCode,404);assert.match(out.payload.error,/unavailable/i);assert.equal(out.payload.result,undefined);
},404));
