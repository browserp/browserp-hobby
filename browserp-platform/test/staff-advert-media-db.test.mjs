import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const migration=readFileSync(new URL("../supabase/migrations/20260905195604_staff_advert_artwork_upload.sql",import.meta.url),"utf8");
const owner="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002";
const id="00000000-0000-4000-8000-000000000003", path=`staff/${owner}/${id}.png`;
const url=`https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/${path}`;
test("advert artwork linking and cleanup preserve referenced assets and deny direct client deletion", async t=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id int,bucket_id text);alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated;grant all on storage.objects to anon,authenticated;
      create table public.uploaded_assets(id uuid primary key,owner_id uuid,bucket text,object_path text,media_type text,moderation_status text,moderation_result jsonb default '{}',created_at timestamptz default now());
      alter table public.uploaded_assets enable row level security;
      create table public.ad_campaigns(id int primary key,image_url text,image_asset_id uuid references public.uploaded_assets(id));
      grant usage on schema public to anon,authenticated,service_role;`);
    await db.exec(migration);
    const insert=()=>db.query("insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,moderation_status) values($1,$2,'advertisements',$3,'advertisement','approved')",[id,owner,path]);
    const claim=async(ownerId=owner)=>(await db.query("select public.claim_advert_media_cleanup($1,$2) result",[id,ownerId])).rows[0].result;
    await insert();
    await t.test("links server artwork atomically and preserves first-party legacy assets",async()=>{
      await db.query("insert into public.ad_campaigns(id,image_url) values(1,$1)",[url.replace("https:","HTTPS:")]);
      const row=(await db.query("select * from public.ad_campaigns where id=1")).rows[0]; assert.equal(row.image_asset_id,id);assert.equal(row.image_url,url);
      assert.deepEqual(await claim(),[]);
      await db.exec("insert into public.ad_campaigns(id,image_url) values(2,'/assets/adverts/existing.jpg')");
      assert.equal((await db.query("select image_asset_id from public.ad_campaigns where id=2")).rows[0].image_asset_id,null);
    });
    await t.test("cleanup cannot be called with anonymous or member credentials",async()=>{
      for(const role of ["anon","authenticated"]) { await db.exec(`set role ${role}`);await assert.rejects(claim(),/permission denied/);await assert.rejects(db.query("select public.complete_advert_media_cleanup($1)",[id]),/permission denied/);await db.exec("reset role"); }
    });
    await t.test("wrong ownership cannot remove an unused upload and a claimed upload cannot be linked",async()=>{
      await db.exec("delete from public.ad_campaigns where id=1");assert.deepEqual(await claim(other),[]);
      assert.equal((await claim())[0].id,id);
      await assert.rejects(db.query("insert into public.ad_campaigns(id,image_url) values(3,$1)",[url]),/Upload this artwork again/);
      assert.equal((await db.query("select public.complete_advert_media_cleanup($1) result",[id])).rows[0].result,true);
      assert.equal((await db.query("select count(*)::int count from public.uploaded_assets")).rows[0].count,0);
    });
    await t.test("scheduled cleanup ignores recent unsaved work and collects old interrupted uploads",async()=>{
      await insert();assert.deepEqual((await db.query("select public.claim_advert_media_cleanup() result")).rows[0].result,[]);
      await db.exec("update public.uploaded_assets set created_at=now()-interval '25 hours',moderation_status='scanning'");
      assert.equal((await db.query("select public.claim_advert_media_cleanup() result")).rows[0].result[0].id,id);
    });
    await t.test("even a broad permissive policy cannot open direct advertisement uploads",async()=>{
      await db.exec("create policy fixture_broad_upload on storage.objects for all to authenticated using(true) with check(true);set role authenticated");
      await assert.rejects(db.exec("insert into storage.objects values(1,'advertisements')"),/row-level security/);
      await db.exec("insert into storage.objects values(2,'another-bucket');reset role");
    });
  } finally {await db.close();}
});
