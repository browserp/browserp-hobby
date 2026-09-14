// Developer-only state controls. No persistence, requests or product controller replacement.
for (const button of document.querySelectorAll("[data-theme-choice]")) {
  button.addEventListener("click", () => {
    document.documentElement.dataset.theme = button.dataset.themeChoice;
    for (const choice of document.querySelectorAll("[data-theme-choice]")) choice.setAttribute("aria-pressed", String(choice === button));
  });
}
document.querySelector("#compact").addEventListener("change", event => document.body.classList.toggle("ds-density-compact", event.target.checked));
document.querySelector("[data-toggle]").addEventListener("click", event => {
  const button = event.currentTarget;
  const selected = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(selected));
  button.textContent = selected ? "Selected" : "Unselected";
});
document.querySelector("#open-dialog").addEventListener("click", () => document.querySelector("#example-dialog").showModal());
