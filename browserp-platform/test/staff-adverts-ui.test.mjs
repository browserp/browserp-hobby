import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class Element {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.textContent = ""; this.value = ""; this.hidden = false; this.classList = { add() {} }; }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  querySelectorAll(selector) { const tags = selector.split(",").map((tag) => tag.toUpperCase()); return this.children.flatMap((child) => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]); }
  reset() { this.querySelectorAll("input,textarea,select").forEach((control) => { control.value = ""; }); }
  focus() {}
  reportValidity() { return true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
}
function runtime() {
  const root = new Element(); const body = new Element("body");
  const document = { body, createElement: (tag) => new Element(tag), querySelector: (selector) => selector === "#overview-adverts" ? root : null };
  const window = { addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL("../public/staff-adverts.js", import.meta.url), "utf8"), { window, document, URL, Intl, Date });
  return { root, body, api: window.BrowseRPStaffAdverts };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("artwork preparation stays local, blocks double saves, and preserves the previous image when replacement fails", async () => {
  const { root, api } = runtime(); const requests = []; let complete;
  const prepared = { name: "Community.png", data: "data:image/png;base64,cHJldmlldw==", width: 640, height: 360 };
  await api.init({ permissions: { manageAdverts: true }, api: async (path, options) => { requests.push({ path, options }); return { adverts: [] }; }, prepareImage: file => file.name === "broken.png" ? Promise.reject(new Error("This image could not be opened.")) : new Promise(resolve => { complete = resolve; }) });
  await root.querySelectorAll("button").find(item => item.textContent === "Create advert").listeners.click();
  const form=root.querySelectorAll("form")[0], file=form.querySelectorAll("input").find(item=>item.type==="file");
  file.files=[{name:"Community.png"}]; const preparing=file.listeners.change();
  assert.equal(root.attributes["aria-busy"],"true");
  form.listeners.submit({preventDefault(){},submitter:{value:"save"}}); await tick();
  assert.equal(requests.length,1,"Preparation and a double submit must not upload");
  complete(prepared);await preparing;
  assert.equal(root.attributes["aria-busy"],"false");assert.equal(requests.length,1);
  assert.equal(form.querySelectorAll("img")[0].src,prepared.data);
  file.files=[{name:"broken.png"}];await file.listeners.change();
  assert.equal(form.querySelectorAll("img")[0].src,prepared.data,"Invalid replacement keeps the good selection");
  assert.ok(root.querySelectorAll("p").some(item=>item.textContent.includes("could not be opened")));
  root.querySelectorAll("button").find(item=>item.textContent==="Remove image").listeners.click();
  assert.equal(form.querySelectorAll("img")[0].hidden,true);assert.equal(requests.length,1);
});

test("failed advert saves clean an uploaded selection and preserve the local preview for retry", async () => {
  const { root, api }=runtime();const requests=[];const imageUrl="https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/staff/fixture.png";
  const prepared={name:"Community.png",data:"data:image/png;base64,cHJldmlldw==",width:640,height:360};
  await api.init({permissions:{manageAdverts:true},prepareImage:async()=>prepared,api:async(path,options)=>{
    const body=options?.body?JSON.parse(options.body):null;requests.push({path,body});
    if(!body)return {adverts:[]};
    if(path.endsWith("/media"))return body.action==="upload"?{asset:{id:"fixture-asset",imageUrl}}:{removed:true};
    throw new Error("Campaign changed. Reload before saving.");
  }});
  await root.querySelectorAll("button").find(item=>item.textContent==="Create advert").listeners.click();
  const form=root.querySelectorAll("form")[0], file=form.querySelectorAll("input").find(item=>item.type==="file");
  const controls=Object.fromEntries(form.querySelectorAll("input,select,textarea").map(item=>[item.name,item]));controls.destinationUrl.value="/servers";
  file.files=[{}];await file.listeners.change();
  form.listeners.submit({preventDefault(){},submitter:{value:"save"}});await tick();await tick();
  assert.deepEqual(requests.filter(item=>item.body).map(item=>[item.path,item.body.action]),[["/api/admin/adverts/media","upload"],["/api/admin/adverts","save"],["/api/admin/adverts/media","remove"]]);
  assert.equal(requests[2].body.imageUrl,imageUrl);assert.equal(controls.imageUrl.value,"");
  assert.equal(form.querySelectorAll("img")[0].src,prepared.data);assert.equal(root.attributes["aria-busy"],"false");
});

test("advert images stay within the existing database allowlist and destinations reject executable URLs", () => {
  const { api } = runtime();
  for (const url of ["", "/assets/adverts/campaign.jpg", "https://www.browserp.com/assets/adverts/season/new.webp", "https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/campaign.v2.png"]) assert.equal(api.allowedImage(url), true, url);
  for (const url of ["https://example.com/campaign.jpg", "/assets/adverts/../campaign.jpg", "/assets/adverts/photo.svg", "/assets/adverts/campaign.png?tracking=1", "https://www.browserp.com.evil.example/assets/adverts/photo.jpg", "data:image/png;base64,eA==", "//example.com/ad.jpg"]) assert.equal(api.allowedImage(url), false, url);
  for (const url of ["/servers", "/games/fivem?region=UK", "https://community.example/join"]) assert.equal(api.allowedDestination(url), true, url);
  for (const url of ["javascript:alert(1)", "//example.com", "/\\example.com", "http://community.example", "https://user:password@example.com", "https://example.com/a b"]) assert.equal(api.allowedDestination(url), false, url);
});

test("advert management makes no data requests without its permission", async () => {
  const { root, api } = runtime(); const requests = [];
  await api.init({ permissions: {}, api: async (path) => requests.push(path) });
  assert.deepEqual(requests, []);
  assert.equal(root.querySelectorAll("button")[0].hidden, true);
});

test("advert publishing requires confirmation and passes the current optimistic version", async () => {
  const { root, body, api } = runtime(); const requests = [];
  let record = { id: "fixture-advert", name: "Fixture campaign", placement: "top", headline: "A community story", body: "Discover a roleplay community with a welcoming atmosphere.", ctaLabel: "Explore", destinationUrl: "/servers", imageUrl: "", status: "draft", version: 7, updatedAt: "2026-09-01T12:00:00Z" };
  const request = async (path, options = {}) => {
    if (options.method === "POST") { const payload = JSON.parse(options.body); requests.push({ path, payload }); record = { ...record, ...payload, status: "active", version: 8 }; return { result: record }; }
    return { adverts: [record] };
  };
  await api.init({ permissions: { manageAdverts: true }, api: request });
  const edit = root.querySelectorAll("button").find((item) => item.attributes["aria-label"] === "Edit advert: Fixture campaign");
  await edit.listeners.click();
  const form = root.querySelectorAll("form")[0]; const controls = Object.fromEntries(form.querySelectorAll("input,textarea,select").map((control) => [control.name, control])); controls.reason.value = "Publish approved campaign";
  form.listeners.submit({ preventDefault() {}, submitter: { value: "activate" } });
  await tick();
  assert.equal(requests.length, 0, "Opening the confirmation must not publish");
  assert.equal(root.attributes["aria-busy"], "true");
  body.children[0].listeners.cancel({ preventDefault() {} }); await tick();
  assert.equal(requests.length, 0, "Cancelling must not publish");
  assert.equal(root.attributes["aria-busy"], "false");
  form.listeners.submit({ preventDefault() {}, submitter: { value: "activate" } }); await tick();
  body.children[0].children[0].listeners.submit({ preventDefault() {} }); await tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/admin/adverts");
  assert.equal(requests[0].payload.action, "activate");
  assert.equal(requests[0].payload.expectedVersion, 7);
  assert.equal(requests[0].payload.reason, "Publish approved campaign");
  assert.equal(root.attributes["aria-busy"], "false");
  assert.equal(controls.reason.value, "");
});

test("failed advert saves preserve the entered content and restore editing controls", async () => {
  const { root, api } = runtime();
  await api.init({ permissions: { manageAdverts: true }, api: async (_path, options = {}) => { if (options.method === "POST") throw new Error("Advert changed; reload first"); return { adverts: [] }; } });
  await root.querySelectorAll("button").find((item) => item.textContent === "Create advert").listeners.click();
  const form = root.querySelectorAll("form")[0]; const controls = Object.fromEntries(form.querySelectorAll("input,textarea,select").map((control) => [control.name, control]));
  Object.assign(controls.headline, { value: "Keep this unsaved headline" }); controls.destinationUrl.value = "/servers"; controls.reason.value = "Draft campaign changes";
  form.listeners.submit({ preventDefault() {}, submitter: { value: "save" } }); await tick();
  assert.equal(controls.headline.value, "Keep this unsaved headline");
  assert.equal(controls.reason.value, "Draft campaign changes");
  assert.equal(controls.headline.disabled, false);
  assert.match(form.children.at(-1).textContent, /Advert changed/);
});
