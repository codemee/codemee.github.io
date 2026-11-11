(() => {
  "use strict";
  const url = new URL(window.location.href);
  const supported = ["zh", "en", "auto"];
  const requested = url.searchParams.get("lang");
  let preference = "auto";
  try {
    const saved = localStorage.getItem("codemee-language");
    if (supported.includes(saved)) preference = saved;
  } catch { /* Language links also work when storage is disabled. */ }
  if (supported.includes(requested)) {
    preference = requested;
    try {
      if (preference === "auto") localStorage.removeItem("codemee-language");
      else localStorage.setItem("codemee-language", preference);
    } catch { /* The URL still records an explicit choice. */ }
  }
  function resolvedLanguage(selection) {
    const browserLanguage = navigator.language || navigator.languages?.[0] || "en";
    return selection === "auto" ? (/^zh(?:-|$)/i.test(browserLanguage) ? "zh" : "en") : selection;
  }
  function languageUrl(selection) {
    const target = new URL(resolvedLanguage(selection) === "en" ? "en.html" : "index.html", window.location.href);
    target.search = window.location.search;
    target.searchParams.set("lang", selection);
    target.hash = window.location.hash;
    return target.href;
  }
  function followLanguage() {
    const language = resolvedLanguage(preference);
    const pageLanguage = document.documentElement.lang.startsWith("zh") ? "zh" : "en";
    if (language !== pageLanguage) {
      const target = new URL(language === "en" ? "en.html" : "index.html", url);
      target.search = url.search;
      target.hash = url.hash;
      window.location.replace(target.href);
    }
  }
  followLanguage();
  window.addEventListener("languagechange", () => {
    if (preference === "auto") followLanguage();
  });
  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("language-toggle");
    const menu = document.getElementById("language-menu");
    const english = document.documentElement.lang === "en";
    const labels = english
      ? { auto: "Follow browser", zh: "Traditional Chinese", en: "English" }
      : { auto: "跟隨瀏覽器", zh: "繁體中文", en: "英文" };
    const sequence = ["auto", "zh", "en"];
    const next = sequence[(sequence.indexOf(preference) + 1) % sequence.length];
    const label = english
      ? `Language: ${labels[preference]}. Switch to ${labels[next]}.`
      : `語言：${labels[preference]}，點擊切換為${labels[next]}`;
    // Auto keeps the inline SVG, which follows the active theme via currentColor.
    if (preference !== "auto") {
      document.getElementById("language-symbol").textContent = { zh: "中", en: "En" }[preference];
    }
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.addEventListener("click", () => window.location.assign(languageUrl(next)));
    document.querySelectorAll("[data-language]").forEach(link => {
      if (link.dataset.language === preference) link.setAttribute("aria-current", "true");
      // Keep the current section when visitors change languages.
      link.href = languageUrl(link.dataset.language);
      link.addEventListener("click", () => {
        link.href = languageUrl(link.dataset.language);
        menu.open = false;
      });
    });
    document.addEventListener("click", event => {
      if (!menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary").focus();
      }
    });
  });
})();
