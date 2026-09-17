(() => {
  "use strict";
  const message = document.querySelector("#member-message-v7");
  const form = document.querySelector("#member-report-form-v7");
  if (!form && !message) return;
  const status = form && document.querySelector("#member-report-status-v7");
  const submit = form?.querySelector('button[type="submit"]');
  let csrfToken = "";
  const signIn = form && document.createElement("a");
  if (signIn) {
    signIn.className = "button-v3 button-secondary-v3";
    signIn.href = `/dashboard?returnTo=${encodeURIComponent(location.pathname)}`;
    signIn.textContent = "Sign in to report";
    signIn.hidden = true;
    form.append(signIn);
  }
  fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" }).then(response => response.json()).then(session => {
    const ownUsername = session?.authenticated ? session.user?.profile?.username : null;
    if (message && (!session?.authenticated || (ownUsername && message.dataset.username !== ownUsername))) {
      message.textContent = session?.authenticated ? "Message" : "Sign in to message";
      message.hidden = false;
    }
    if (!form) return;
    if (session?.authenticated && typeof session.csrfToken === "string") { csrfToken = session.csrfToken; return; }
    form.querySelectorAll("select,textarea,button[type=submit]").forEach(control => { control.disabled = true; });
    signIn.hidden = false;
  }).catch(() => { if (status) status.textContent = "Sign-in status is unavailable. Try again in a moment."; });
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled || !csrfToken || !form.reportValidity()) return;
    submit.disabled = true; submit.setAttribute("aria-busy", "true"); status.textContent = "Sending your report…";
    try {
      const response = await fetch("/api/public/profile-report", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-BrowseRP-CSRF": csrfToken },
        body: JSON.stringify({ username: form.dataset.username, ...Object.fromEntries(new FormData(form)) })
      });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result?.error || result?.message || "The report could not be sent."), { status: response.status });
      status.textContent = "Report sent to the BrowseRP team."; form.reset();
    } catch (error) {
      status.textContent = error.message;
      if (error.status === 401) signIn.hidden = false;
    } finally { submit.disabled = false; submit.removeAttribute("aria-busy"); }
  });
})();
