import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

test('Minecraft review renders imported artwork through the supplied same-origin image helper',async t=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://browserp.test/staffpanel/scrapers#minecraft',runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window,root=w.document.querySelector('#root');
 w.eval(readFileSync(new URL('../public/staff-minecraft.js',import.meta.url),'utf8'));
 const logoUrl='https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/server-media/123456789abc/'+ 'a'.repeat(64)+'.png';
 const bannerUrl='https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/server-media/123456789abc/'+ 'b'.repeat(64)+'.png';
 const routed=[];
 const component=await w.BrowseRPStaffMinecraft.init({root,imageUrl:url=>{routed.push(url);return '/api/public/server-image?url='+encodeURIComponent(url);},api:async()=>({workspace:{canManage:true,total:1,items:[{id:'fixture-import',joinCode:'123456789abc',status:'pending',version:1,candidate:{name:'Minecraft fixture',address:'play.example.com:25565',edition:'java',logoUrl,bannerUrl}}]}})});
 t.after(()=>component.destroy());root.querySelector('.fivem-item button').click();await new Promise(resolve=>setImmediate(resolve));
 const images=[...root.querySelectorAll('.fivem-media img')];assert.equal(images.length,2);
 assert.deepEqual(routed,[bannerUrl,logoUrl]);
 for(const image of images){const url=new URL(image.src);assert.equal(url.origin,'https://browserp.test');assert.equal(url.pathname,'/api/public/server-image');assert.ok([bannerUrl,logoUrl].includes(url.searchParams.get('url')));assert.match(image.alt,/^(Banner|Logo) preview$/);}
 assert.doesNotMatch(root.querySelector('.fivem-media').textContent,/Preview is unavailable/);
 images[0].dispatchEvent(new w.Event('error'));assert.equal(images[0].hidden,true);assert.match(images[0].parentElement.textContent,/could not be loaded/);
 const logo=root.querySelector('[name="logoUrl"]');logo.value='javascript:alert(1)';logo.dispatchEvent(new w.Event('change'));
 assert.equal(root.querySelectorAll('.fivem-media img').length,1);assert.equal(routed.includes('javascript:alert(1)'),false);
});
