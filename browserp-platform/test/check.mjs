import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const targets = ["api", "lib", "public", "test"];
const files = [join(root, "dev-server.mjs")];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if ([".js", ".mjs"].includes(extname(path))) files.push(path);
  }
}

for (const target of targets) walk(join(root, target));
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}
console.log(`Syntax checked ${files.length} JavaScript files.`);

const apiFunctionCount = files.filter((file) => file.startsWith(join(root, "api")) && extname(file) === ".js").length;
if (apiFunctionCount > 12) {
  console.error(`Vercel Hobby supports at most 12 functions; found ${apiFunctionCount}.`);
  process.exit(1);
}
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
if (vercel.outputDirectory !== "public") {
  console.error("Vercel outputDirectory must remain public.");
  process.exit(1);
}
console.log(`Vercel deployment checks passed with ${apiFunctionCount} functions.`);
