const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const initials = (name) => String(name || "BR").split(/\s+/).slice(0,2).map((word)=>word[0]).join("").toUpperCase();
const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString([], {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
};

async function api(path, options={}) {
  const response = await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const payload = await response.json().catch(()=>({error:"The response could not be read."}));
  if(!response.ok) throw Object.assign(new Error(payload.error||"Request failed."),{status:response.status});
  return payload;
}

function signInGate(title, message) {
  return `<section class="access-gate"><span class="brand-mark"><span>B</span></span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button button-primary" href="/api/auth/discord?returnTo=${encodeURIComponent(location.pathname+location.search)}">Continue with Discord</a></section>`;
}

async function updateAuth() {
  const button=$("#page-auth");
  if(!button) return null;
  try {
    const session=await api("/api/auth/session");
    if(session.authenticated){button.textContent=session.user.profile?.display_name||"Dashboard";button.href="/dashboard";}
    else {
      const authState=new URLSearchParams(location.search).get("auth");
      if(authState==="failed") session.error="Discord could not finish signing you in. Please try again.";
      if(authState==="discord-not-configured") session.error="Discord sign-in still needs to be enabled in the BrowseRP authentication settings.";
      if(authState==="backend-not-configured") session.error="BrowseRP sign-in is waiting for its production backend environment variables.";
    }
    return session;
  } catch (error) { return {authenticated:false, error:error.message, status:error.status}; }
}

function metric(label,value,note){return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;}

function staffButtons(kind,id,actions,enabled=true){
  if(!enabled) return "";
  return `<div class="portal-actions">${actions.map(([action,label,tone="secondary"])=>`<button type="button" class="staff-action staff-action-${escapeHtml(tone)}" data-staff-kind="${escapeHtml(kind)}" data-staff-id="${escapeHtml(id)}" data-staff-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`).join("")}</div>`;
}

function staffQueueSection({id,title,description,items,empty,render}){
  return `<section class="portal-panel staff-panel-wide" id="${escapeHtml(id)}"><div class="staff-panel-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><span>${items.length}</span></div><div class="portal-list">${items.length?items.map(render).join(""):`<p class="queue-empty">${escapeHtml(empty)}</p>`}</div></section>`;
}

async function dashboardPage(session){
  const root=$("#page-content");
  if(!session?.authenticated){root.innerHTML=signInGate("Your BrowseRP dashboard",session?.error||"Sign in to manage submissions, owned communities, favourites, notifications and fixed promotion credits.");return;}
  try{
    const {overview}=await api("/api/me/overview");
    const profile=overview?.profile||session.user.profile||{};
    const servers=overview?.servers||[];
    const submissions=overview?.submissions||[];
    const favourites=overview?.favoriteServers||[];
    const notifications=overview?.notifications||[];
    root.innerHTML=`
      <div class="portal-welcome"><div><span class="section-kicker">OWNER CENTRE</span><h1>Welcome, ${escapeHtml(profile.display_name||"member")}.</h1><p>Everything important, with no noisy vanity metrics.</p></div><button class="button button-secondary" id="logout-button">Sign out</button></div>
      <div class="metric-grid">${metric("Owned servers",servers.length,"Current account")}${metric("Promotion credits",overview?.promotionCredits||0,"No cash value")}${metric("Favourites",overview?.favorites||0,"Saved communities")}${metric("Unread",overview?.unreadNotifications||0,"Notifications")}</div>
      <div class="portal-grid"><section class="portal-panel"><h2>Your communities</h2><p>Published listings and work in review.</p><div class="portal-list">${servers.length?servers.map((server)=>`<a class="portal-row" href="/server/${encodeURIComponent(server.slug)}"><span>${escapeHtml(initials(server.name))}</span><span><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(server.status)}</small></span><span>Open →</span></a>`).join(""):'<div class="portal-row"><span>＋</span><span><strong>No owned listing yet</strong><small>Submit one from the directory.</small></span><a href="/#discover">Start</a></div>'}</div></section>
      <section class="portal-panel"><h2>Review queue</h2><p>Your latest listing submissions.</p><div class="portal-list">${submissions.length?submissions.map((item)=>`<div class="portal-row"><span>◇</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.status)}</small></span><time>${dateLabel(item.created_at)}</time></div>`).join(""):'<p>No submissions yet.</p>'}</div></section></div>
      <div class="portal-grid"><section class="portal-panel"><h2>Saved communities</h2><p>Favourites synced to this account.</p><div class="portal-list">${favourites.length?favourites.map((server)=>`<a class="portal-row" href="/server/${encodeURIComponent(server.slug)}"><span>♥</span><span><strong>${escapeHtml(server.name)}</strong><small>Saved ${dateLabel(server.created_at)}</small></span><span>Open →</span></a>`).join(""):'<p>No saved communities yet.</p>'}</div></section>
      <section class="portal-panel"><div class="staff-panel-head"><div><h2>Notifications</h2><p>Account and review updates.</p></div>${Number(overview?.unreadNotifications||0)>0?'<button class="staff-action" type="button" id="read-notifications">Mark all read</button>':''}</div><div class="portal-list">${notifications.length?notifications.map((item)=>`<div class="portal-row"><span>${item.read_at?'✓':'•'}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body)}</small></span><time>${dateLabel(item.created_at)}</time></div>`).join(""):'<p>No notifications yet.</p>'}</div></section></div>`;
    $("#logout-button")?.addEventListener("click",async()=>{await api("/api/auth/logout",{method:"POST",body:"{}"});location.assign("/");});
    $("#read-notifications")?.addEventListener("click",async(event)=>{event.currentTarget.disabled=true;try{await api("/api/me/notifications/read",{method:"POST",body:"{}"});await dashboardPage(session);}catch(error){event.currentTarget.disabled=false;event.currentTarget.textContent=error.message;}});
  }catch(error){root.innerHTML=signInGate("Dashboard connection pending",error.message);}
}

async function staffPage(session){
  const root=$("#page-content");
  if(!session?.authenticated){root.innerHTML=signInGate("Staff access",session?.error||"Sign in with the Discord account attached to your authorized staff membership.");return;}
  try{
    const {overview}=await api("/api/admin/overview");
    const permissions=new Set(overview.permissions||[]);
    const listings=overview.listingQueue||[];
    const reports=overview.reportQueue||[];
    const moderation=overview.moderationQueue||[];
    const security=overview.securityEvents||[];
    const audit=overview.recentAudit||[];
    const sections=[];
    if(permissions.has("servers.review")) sections.push(staffQueueSection({
      id:"listings",title:"Listing reviews",description:"Approve safe submissions, request changes, or reject with a recorded reason.",items:listings,empty:"No listing submissions need review.",
      render:(item)=>`<div class="portal-row staff-queue-row"><span>◇</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platform_id)} · ${escapeHtml(item.region)} · ${escapeHtml(item.moderation_confidence)} (${escapeHtml(item.moderation_score)}) · ${dateLabel(item.created_at)}</small></span>${staffButtons("listing",item.id,[["approved","Approve","success"],["changes_requested","Changes"],["rejected","Reject","danger"]])}</div>`
    }));
    if(permissions.has("reports.read")) sections.push(staffQueueSection({
      id:"reports",title:"Member reports",description:"Triage and close reports without exposing private reporter details in the queue.",items:reports,empty:"No reports need attention.",
      render:(item)=>`<div class="portal-row staff-queue-row"><span>!</span><span><strong>${escapeHtml(item.category)}</strong><small>${escapeHtml(item.target_type)} · ${escapeHtml(item.status)} · ${dateLabel(item.created_at)}</small></span>${staffButtons("report",item.id,[["triaged","Triage"],["resolved","Resolve","success"],["dismissed","Dismiss","danger"]],permissions.has("reports.resolve"))}</div>`
    }));
    if(permissions.has("moderation.read")) sections.push(staffQueueSection({
      id:"moderation",title:"Moderation queue",description:"Review deterministic safety flags and record each outcome.",items:moderation,empty:"The moderation queue is clear.",
      render:(item)=>`<div class="portal-row staff-queue-row"><span>✓</span><span><strong>${escapeHtml(item.target_type)}</strong><small>${escapeHtml(item.confidence)} · score ${escapeHtml(item.score)} · ${escapeHtml(item.status)} · ${dateLabel(item.created_at)}</small></span>${staffButtons("moderation",item.id,[["claimed","Claim"],["resolved","Resolve","success"],["dismissed","Dismiss","danger"]],permissions.has("moderation.resolve"))}</div>`
    }));
    if(permissions.has("security.read")) sections.push(staffQueueSection({
      id:"security",title:"Security signals",description:"Only privacy-preserving event summaries are shown here.",items:security,empty:"No unresolved security signals.",
      render:(item)=>`<div class="portal-row staff-queue-row"><span>⌾</span><span><strong>${escapeHtml(item.event_type)}</strong><small>${escapeHtml(item.severity)} · ${dateLabel(item.created_at)}</small></span>${staffButtons("security",item.id,[["resolved","Mark resolved","success"]],permissions.has("settings.manage"))}</div>`
    }));
    if(permissions.has("audit.read")) sections.push(staffQueueSection({
      id:"audit",title:"Audit log",description:"Actor, target, reason, and request context are retained for every staff decision.",items:audit,empty:"No staff actions have been recorded.",
      render:(item)=>`<div class="portal-row"><span>↗</span><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.target_type)} · ${escapeHtml(item.reason)}</small></span><time>${dateLabel(item.created_at)}</time></div>`
    }));
    root.innerHTML=`<div class="portal-welcome"><div><span class="section-kicker">ACCOUNTABLE OPERATIONS · ${escapeHtml(overview.role?.name||"Staff")}</span><h1>Staff centre</h1><p>Permission-scoped queues with audited decisions and no bulk enforcement shortcuts.</p></div><div class="portal-welcome-actions"><a class="button button-secondary" href="/legal#standards">Standards</a><button class="button button-secondary" id="staff-logout" type="button">Sign out</button></div></div><div class="metric-grid">${metric("Listing reviews",overview.pendingSubmissions,"Awaiting review")}${metric("Moderation",overview.openModeration,"Open cases")}${metric("Reports",overview.openReports,"Needs triage")}${metric("Security",overview.securityAlerts,"High-priority alerts")}</div><p class="staff-live-status" id="staff-live-status" role="status" aria-live="polite"></p><div class="staff-workspace">${sections.join("")||'<section class="portal-panel"><h2>No assigned queues</h2><p>Your staff role is active but has no readable operations queues.</p></section>'}</div>`;
    $("#staff-logout")?.addEventListener("click",async()=>{await api("/api/auth/logout",{method:"POST",body:"{}"});location.assign("/");});
    root.querySelectorAll("[data-staff-action]").forEach((button)=>button.addEventListener("click",async()=>{
      const label=button.textContent.trim();
      const reason=window.prompt(`${label}: enter the reason that will be written to the audit log.`);
      if(reason===null) return;
      if(reason.trim().length<5){window.alert("Enter a reason of at least five characters.");return;}
      if(!window.confirm(`Confirm ${label.toLowerCase()} for this one item?`)) return;
      root.querySelectorAll("[data-staff-action]").forEach((item)=>item.disabled=true);
      const status=$("#staff-live-status");
      if(status) status.textContent="Saving the audited staff action…";
      try{
        await api("/api/admin/action",{method:"POST",body:JSON.stringify({kind:button.dataset.staffKind,id:button.dataset.staffId,action:button.dataset.staffAction,reason})});
        await staffPage(session);
      }catch(error){
        root.querySelectorAll("[data-staff-action]").forEach((item)=>item.disabled=false);
        if(status) status.textContent=error.message;
      }
    }));
  }catch(error){root.innerHTML=signInGate("Staff permission required",error.status===403||error.status===401?"This account does not have access to staff systems.":error.message);}
}

async function catalogPage(type){
  const root=$("#catalog-grid");
  try{
    const payload=await api(`/api/${type}`);
    const items=payload[type]||[];
    if(!items.length){root.innerHTML='<div class="empty-panel"><h2>Nothing published yet</h2><p>Reviewed entries will appear here as the community grows.</p></div>';return;}
    root.innerHTML=items.map((item)=>type==="developers"?`<article class="catalog-card"><div class="catalog-card-top"><span class="catalog-avatar">${escapeHtml(initials(item.display_name))}</span>${item.verified?'<span class="catalog-badge">✓ VERIFIED</span>':'<span class="catalog-badge">IN REVIEW</span>'}</div><h2>${escapeHtml(item.display_name)}</h2><p>${escapeHtml(item.headline)}</p><div class="catalog-tags">${(item.specialties||[]).map((tag)=>`<span>${escapeHtml(tag)}</span>`).join("")}</div><button class="button button-secondary" type="button" disabled>Profile details</button></article>`:`<article class="catalog-card"><div class="catalog-card-top"><span class="catalog-avatar">${escapeHtml(String(item.resource_type||"R").slice(0,2).toUpperCase())}</span><span class="catalog-badge">REVIEWED</span></div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary)}</p><div class="catalog-tags"><span>${escapeHtml(item.resource_type)}</span><span>${escapeHtml(item.platform_name||"All platforms")}</span><span>${Number(item.downloads||0).toLocaleString()} downloads</span></div><button class="button button-secondary" type="button" disabled>Open resource</button></article>`).join("");
  }catch(error){root.innerHTML=`<div class="empty-panel"><h2>Could not load this catalog</h2><p>${escapeHtml(error.message)}</p></div>`;}
}

async function serverPage(){
  const root=$("#server-content");
  const slug=location.pathname.split("/").filter(Boolean).pop()||new URLSearchParams(location.search).get("slug");
  try{
    const {servers}=await api(`/api/servers?query=${encodeURIComponent(slug)}&limit=100`);
    const server=servers.find((item)=>item.slug===slug);
    if(!server) throw Object.assign(new Error("This community is not published or could not be found."),{status:404});
    document.title=`${server.name} — BrowseRP`;
    root.innerHTML=`<section class="server-profile-hero"><div class="shell server-profile-head"><div class="server-profile-logo">${escapeHtml(initials(server.name))}</div><div><span class="section-kicker" style="color:#c9c4ff">${escapeHtml(server.platform_name)} · ${escapeHtml(server.region)}</span><h1>${escapeHtml(server.name)} ${server.verified?'✓':''}</h1><p>${server.online?'Online now':'Status unavailable'} · ${escapeHtml(server.language)} · ${escapeHtml(server.framework||'Community framework')}</p><div class="server-profile-tags">${(server.tags||[]).map((tag)=>`<span>${escapeHtml(tag)}</span>`).join("")}</div></div><div class="server-live"><strong>${Number(server.players).toLocaleString()}</strong><small>of ${Number(server.capacity).toLocaleString()} players</small></div></div></section><main class="shell server-detail-grid"><article class="detail-card"><span class="section-kicker">ABOUT THIS WORLD</span><h2>A community built for its players.</h2><p>${escapeHtml(server.description)}</p><a class="button button-primary" href="/api/auth/discord?returnTo=${encodeURIComponent(location.pathname)}">Sign in to favourite</a></article><aside class="detail-card"><h2>Trust signals</h2><div class="signal-list"><div class="signal-row"><span>Owner review</span><strong>${server.verified?'Verified':'Not verified'}</strong></div><div class="signal-row"><span>30-day uptime</span><strong>${Number(server.uptime_percent).toFixed(1)}%</strong></div><div class="signal-row"><span>Beginner friendly</span><strong>${server.beginner_friendly?'Yes':'Not marked'}</strong></div><div class="signal-row"><span>Discovery score</span><strong>${Number(server.discovery_score).toFixed(1)}</strong></div></div></aside></main>`;
  }catch(error){root.innerHTML=`<main class="shell page-main">${signInGate("Community not found",error.message).replace('/api/auth/discord?returnTo=','/?q=')}</main>`;}
}

async function init(){
  const session=await updateAuth();
  const page=document.body.dataset.page;
  if(page==="dashboard") await dashboardPage(session);
  if(page==="staff") await staffPage(session);
  if(page==="developers"||page==="resources") await catalogPage(page);
  if(page==="server") await serverPage();
}
init();
