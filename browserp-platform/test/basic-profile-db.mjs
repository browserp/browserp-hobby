import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("basic visibility is opt-in while existing choices and the public default remain", async () => {
  const db = new PGlite();
  try {
    await db.exec("create schema if not exists public; create table public.profiles (profile_visibility text not null default 'public' constraint profiles_profile_visibility_check check (profile_visibility in ('public','members','private')))");
    const migration = readFileSync(new URL("../supabase/migrations/20260917023624_basic_public_profile_visibility.sql", import.meta.url), "utf8");
    await db.exec(migration.split("-- Preserve the existing member/session/moderation gates")[0]);
    await db.exec("insert into public.profiles default values; insert into public.profiles(profile_visibility) values ('public'),('members'),('private'),('basic')");
    const result = await db.query("select profile_visibility from public.profiles order by profile_visibility");
    assert.deepEqual(result.rows.map(row => row.profile_visibility), ["basic", "members", "private", "public", "public"]);
    await assert.rejects(db.exec("insert into public.profiles(profile_visibility) values ('unknown')"), /check constraint/);
  } finally {
    await db.close();
  }
});
