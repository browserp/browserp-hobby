(() => {
  "use strict";
  function init({ api, session, toast }) {
    const returnTo = /^\/server\/[a-z0-9-]+\/?$/i.test(location.pathname) ? location.pathname : "/servers";
    const signInUrl = `/dashboard?returnTo=${encodeURIComponent(returnTo)}`;
    const vote = document.querySelector("#vote-server-v3");
    if (vote) {
      vote.disabled = false;
      if (!session?.authenticated) vote.textContent = "Sign in to vote";
      vote.addEventListener("click", async () => {
        if (!session?.authenticated) { location.assign(signInUrl); return; }
        if (vote.disabled || !vote.dataset.serverId) return;
        vote.disabled = true; vote.setAttribute("aria-busy", "true");
        try {
          const { result } = await api("/api/servers", { method: "POST", body: JSON.stringify({ action: "vote", serverId: vote.dataset.serverId }) });
          document.querySelector("#server-votes-v3").textContent = `${Number(result.voteCount || 0).toLocaleString()} votes`;
          vote.textContent = "Voted"; vote.setAttribute("aria-pressed", "true");
        } catch (error) { vote.disabled = false; toast(error.message, "error"); }
        finally { vote.removeAttribute("aria-busy"); }
      });
    }
    for (const action of ["comment", "report"]) {
      const form = document.querySelector(`#${action}-form-v3`);
      if (!form || form.dataset.interactionsReady) continue;
      form.dataset.interactionsReady = "true";
      const submit = form.querySelector("button[type=submit]");
      const status = document.createElement("p"); status.setAttribute("role", "status"); status.hidden = true;
      const signIn = document.createElement("a"); signIn.className = "button-v3 button-secondary-v3";
      signIn.href = signInUrl; signIn.textContent = action === "comment" ? "Sign in to comment" : "Sign in to report";
      signIn.hidden = Boolean(session?.authenticated);
      form.append(status, signIn);
      const signedIn = Boolean(session?.authenticated);
      form.querySelectorAll("textarea,select,button[type=submit]").forEach(control => { control.disabled = !signedIn; });
      if (!signedIn) {
        form.querySelectorAll(".field-v3,button[type=submit]").forEach(control => { control.hidden = true; });
        status.textContent = "Sign in first. We’ll bring you back to this server."; status.hidden = false;
      }
      let busy = false;
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!signedIn || busy || !form.dataset.serverId) return;
        busy = true; if (submit) submit.disabled = true; form.setAttribute("aria-busy", "true");
        const data = new FormData(form);
        const body = action === "comment" ? { action, serverId: form.dataset.serverId, body: data.get("comment") }
          : { action, serverId: form.dataset.serverId, category: data.get("category"), body: data.get("details") };
        try {
          await api("/api/servers", { method: "POST", body: JSON.stringify(body) });
          form.reset(); status.hidden = false;
          status.textContent = action === "comment" ? "Comment sent for moderation." : "Report received. Staff can now review it.";
          toast(status.textContent);
        } catch (error) {
          // Keep the actual form values on failures, including session expiry.
          status.hidden = false;
          status.textContent = error.status === 401
            ? "Your sign-in has expired. Your text is still here. Copy it before signing in again."
            : error.message;
          if (error.status === 401) signIn.hidden = false;
          toast(error.message, "error");
        } finally { busy = false; if (submit) submit.disabled = false; form.removeAttribute("aria-busy"); }
      });
    }
  }
  window.BrowseRPServerInteractions = { init };
})();
