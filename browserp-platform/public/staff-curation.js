(() => {
  "use strict";
  const make=(tag,text,className="")=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);el.className=className;return el;};
  async function init({api,root,platform,inputs}){
    const result=await api(`/api/admin/${platform}?research=true`);const candidates=Array.isArray(result.curation?.candidates)?result.curation.candidates:[];
    if(!candidates.length)return{show(){}};
    const section=make("details",undefined,"staff-curation-list");section.append(make("summary",`Researched launch shortlist (${candidates.length})`));
    section.append(make("p","Selected for roleplay focus, clear community information and current source checks. Recheck the live source before publishing; no selection is a guarantee of community quality.","fivem-help"));
    const list=make("div",undefined,"staff-curation-options");
    for(const c of candidates){const row=make("div",undefined,"staff-curation-option"),use=make("button",`Use ${c.name}`,"button-v3 button-secondary-v3");use.type="button";use.addEventListener("click",()=>{inputs.value=c.address||c.joinCode;const edition=root.querySelector('[name="edition"]');if(edition&&c.edition)edition.value=c.edition;inputs.focus();});row.append(use,make("span",(c.inclusionReasons||[]).slice(0,2).join(" · "),"fivem-help"));list.append(row);}
    section.append(list);root.prepend(section);
    const review=make("section",undefined,"staff-curation-review");review.hidden=true;root.querySelector(".fivem-fields")?.before(review);
    function show(candidate,controls,onApply){
      const c=candidates.find(item=>item.joinCode===candidate.joinCode);review.replaceChildren();review.hidden=!c;if(!c)return;
      review.append(make("h4","Research and reviewed details"),make("p",(c.inclusionReasons||[]).join(" · "),"fivem-help"));
      const sources=make("ul");for(const source of c.sources||[]){try{const url=new URL(source.url);if(url.protocol!=="https:"||url.username||url.password)continue;const item=make("li"),link=make("a",source.purpose||url.hostname);link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";item.append(link);sources.append(item);}catch{}}
      review.append(sources);if(c.conflicts?.length)review.append(make("p",`Review notes: ${c.conflicts.join(" ")}`,"fivem-help"));
      const apply=make("button","Apply researched details","button-v3 button-secondary-v3");apply.type="button";
      apply.addEventListener("click",()=>{for(const key of ["name","description","region","language","framework","accessType","discordUrl","websiteUrl","tags","keywords"]){if(!Object.hasOwn(c,key)||!controls[key])continue;controls[key].value=Array.isArray(c[key])?c[key].join(", "):c[key]??"";}for(const key of ["logoUrl","bannerUrl"]){if(Object.hasOwn(c,key)&&controls[key])controls[key].value=c[key]??"";}controls.reason.value=`Reviewed English-speaking launch selection: ${c.name}. Checked source identity, community information, links and artwork.`.slice(0,500);onApply();apply.textContent="Research applied — review before publishing";});
      review.append(apply);
    }
    return{show};
  }
  window.BrowseRPStaffCuration=Object.freeze({init});
})();
