import { readFileSync } from "node:fs";

// This material is returned only after the importer checks the signed-in staff permission.
const paths={
  fivem:new URL("../docs/launch-curation/fivem-candidates.json",import.meta.url),
  redm:new URL("../docs/launch-curation/redm-candidates.json",import.meta.url),
  minecraft:new URL("../docs/launch-curation/minecraft-candidates.json",import.meta.url)
};
export function launchCuration(platform){
  if(!Object.hasOwn(paths,platform))return{candidates:[]};
  let report;try{report=JSON.parse(readFileSync(paths[platform],"utf8"));}catch{return{candidates:[]};}
  return{generatedAt:report.generatedAt,candidates:(Array.isArray(report.candidates)?report.candidates:[]).filter(c=>c.status==="publish").slice(0,80)};
}
