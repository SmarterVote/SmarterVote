// Theme bootstrap for the static 404 page (served for any unknown URL, so it is
// loaded by absolute path). Mirrors app.html: honor the saved darkMode choice,
// else the OS setting. Kept out of 404.html so that page needs no inline script
// and can carry a strict script-src.
(function () {
  var dark = false;
  try {
    var saved = localStorage.getItem("darkMode");
    dark =
      saved !== null
        ? saved === "true"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      // No storage or media queries: keep the light theme.
    }
  }
  document.documentElement.classList.add(dark ? "dark" : "light");
})();
