(() => {
  "use strict";
  const isEnglish = document.documentElement.lang === "en";
  const messages = {
    en: {
      system: "System", light: "Light", dark: "Dark",
      theme: (current, next) => `Theme: ${current}. Switch to ${next}.`,
      feedUpdated: "Latest article updated",
      feedUnavailable: "Unable to refresh. Showing a previously retrieved article.",
      download: (tool, platform, silicon) => `Download ${tool} for ${platform}${silicon ? " (Apple Silicon)" : ""}`,
      notAvailable: "not available",
      unavailableDownload: (tool, tag, platform) => `${tool} ${tag}: ${platform} is not available`,
      latestVersion: tag => "Latest release " + tag,
      releaseUnavailable: "Unable to check for updates. See release notes."
    },
    zh: {
      system: "跟隨系統", light: "淺色", dark: "深色",
      theme: (current, next) => `配色：${current}，點擊切換${next}`,
      feedUpdated: "已更新最新文章",
      feedUnavailable: "暫時無法更新，顯示先前取得的文章",
      download: (tool, platform, silicon) => `下載 ${tool} ${platform}${silicon ? "（Apple Silicon）" : ""}`,
      notAvailable: "暫未提供",
      unavailableDownload: (tool, tag, platform) => `${tool} ${tag} 暫未提供 ${platform}`,
      latestVersion: tag => "最新版本 " + tag,
      releaseUnavailable: "暫時無法確認最新版本，請查看版本說明"
    }
  };
  const text = messages[isEnglish ? "en" : "zh"];
  const modes = ["system", "light", "dark"];
  const labels = { system: text.system, light: text.light, dark: text.dark };
  let mode = "system";
  try {
    const saved = localStorage.getItem("codemee-theme");
    if (modes.includes(saved)) mode = saved;
  } catch { /* Storage may be disabled; theme controls still work. */ }
  const button = document.getElementById("theme-toggle");
  const themeMenu = document.getElementById("theme-menu");
  const themeOptions = document.querySelectorAll("[data-theme-option]");
  const themeSymbols = { system: "◐", light: "☀", dark: "☾" };
  function applyTheme() {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = mode;
    document.getElementById("theme-symbol").textContent = themeSymbols[mode];
    const next = modes[(modes.indexOf(mode) + 1) % modes.length];
    const label = text.theme(labels[mode], labels[next]);
    button.setAttribute("aria-label", label);
    button.title = label;
    themeOptions.forEach(option => option.setAttribute("aria-pressed", String(option.dataset.themeOption === mode)));
  }
  function setTheme(selected) {
    if (!modes.includes(selected)) return;
    mode = selected;
    applyTheme();
    try { localStorage.setItem("codemee-theme", mode); } catch { /* Optional preference. */ }
  }
  applyTheme();
  button.addEventListener("click", () => setTheme(modes[(modes.indexOf(mode) + 1) % modes.length]));
  themeOptions.forEach(option => {
    option.addEventListener("click", () => {
      setTheme(option.dataset.themeOption);
      themeMenu.open = false;
      themeMenu.querySelector("summary").focus();
    });
  });
  document.addEventListener("click", event => {
    if (!themeMenu.contains(event.target)) themeMenu.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && themeMenu.open) {
      themeMenu.open = false;
      themeMenu.querySelector("summary").focus();
    }
  });
  document.getElementById("year").textContent = new Date().getFullYear();

  // Never insert source HTML. Only accept links on the expected article host.
  function updatePost(id, post, hostname) {
    const url = new URL(post.url);
    const date = new Date(post.date);
    if (url.protocol !== "https:" || url.hostname !== hostname || !post.title || Number.isNaN(date.getTime())) {
      throw new Error("Invalid article");
    }
    const card = document.getElementById(id);
    const link = card.querySelector(".post-link");
    link.textContent = post.title + " ↗";
    link.href = url.href;
    const time = card.querySelector("time");
    time.dateTime = date.toISOString();
    time.textContent = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(date).replaceAll("-", ".");
    card.querySelector(".feed-status").textContent = text.feedUpdated;
  }
  function unavailable(id) {
    document.querySelector(`#${id} .feed-status`).textContent = text.feedUnavailable;
  }
  async function loadDev() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("https://dev.to/api/articles?username=codemee&per_page=1", { signal: controller.signal });
      if (!response.ok) throw new Error("Article request failed");
      const posts = await response.json();
      const post = posts[0];
      updatePost("dev-article", { title: post.title, url: post.url, date: post.published_at }, "dev.to");
    } catch { unavailable("dev-article"); }
    finally { clearTimeout(timeout); }
  }
  // Blogger's official JSONP feed supports static sites without a proxy or API key.
  function loadBlogger() {
    const script = document.createElement("script");
    const callback = "__codemeeBloggerLatest";
    let settled = false;
    function finish(success) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.remove();
      delete window[callback];
      if (!success) unavailable("blogger-article");
    }
    window[callback] = (data) => {
      try {
        const post = data.feed.entry[0];
        const link = post.link.find(item => item.rel === "alternate");
        updatePost("blogger-article", { title: post.title.$t, url: link.href, date: post.published.$t }, "meebox.blogspot.com");
        finish(true);
      } catch { finish(false); }
    };
    const timeout = setTimeout(() => finish(false), 10000);
    script.src = `https://meebox.blogspot.com/feeds/posts/default?alt=json-in-script&max-results=1&callback=${callback}`;
    script.onerror = () => finish(false);
    document.head.append(script);
  }
  // Versioned filenames change on each release; resolve the latest assets by format.
  const releaseRefreshInterval = 15 * 60 * 1000;
  const pendingReleaseRequests = new WeakSet();
  function releaseDownloads(repo, release) {
    if (!release.tag_name || !Array.isArray(release.assets)) throw new Error("Invalid release");
    const downloads = { tag: release.tag_name };
    for (const format of ["windows", "dmg"]) {
      let asset;
      if (format === "windows") {
        const pattern = repo === "mvapp"
          ? /^mvapp(?:-windows-(?:x64|x86_64))?\.(zip|exe)$/i
          : /windows-(?:x64|x86_64)\.(zip|exe)$/i;
        // Prefer the new ZIP packages, while supporting older EXE releases.
        const extensions = repo === "feditor" ? ["exe"] : ["zip", "exe"];
        for (const extension of extensions) {
          asset = release.assets.find(item => pattern.test(item.name) && item.name.toLowerCase().endsWith("." + extension));
          if (asset) break;
        }
      } else if (repo !== "mvapp") {
        const pattern = repo === "feditor" ? /^feditor-macos(?:-arm64)?\.dmg$/i : /macos-arm64\.dmg$/i;
        asset = release.assets.find(item => pattern.test(item.name));
      }
      if (!asset) continue;
      const url = new URL(asset.browser_download_url);
      const extension = format === "windows" ? asset.name.split(".").pop().toLowerCase() : "dmg";
      if (url.origin !== "https://github.com" || !url.pathname.startsWith(`/codemee/${repo}/releases/download/`) || !url.pathname.toLowerCase().endsWith("." + extension)) {
        throw new Error("Invalid download URL");
      }
      downloads[format] = url.href;
      if (format === "windows") downloads.windowsFormat = extension;
    }
    return downloads;
  }
  function renderDownloads(group, downloads) {
    for (const format of ["windows", "dmg"]) {
      const link = group.querySelector(`[data-format="${format}"]`);
      if (!link) continue;
      const extension = downloads.windowsFormat || link.dataset.extension || "zip";
      const platform = format === "windows" ? "Windows ." + extension : "macOS .dmg";
      link.title = downloads.tag;
      if (downloads[format]) {
        link.href = downloads[format];
        if (format === "windows") link.dataset.extension = extension;
        link.removeAttribute("aria-disabled");
        link.textContent = "↓ " + platform;
        link.setAttribute("aria-label", text.download(group.dataset.tool, platform, format === "dmg"));
      } else {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        link.textContent = platform + " " + text.notAvailable;
        link.setAttribute("aria-label", text.unavailableDownload(group.dataset.tool, downloads.tag, platform));
      }
    }
    group.querySelector(".download-status").textContent = text.latestVersion(downloads.tag);
  }
  async function loadToolDownloads(group, force = false) {
    const repo = group.dataset.repo;
    if (!["fshot", "repdf", "rgpdf", "picview", "prkit", "feditor", "mvapp"].includes(repo)) return;
    if (pendingReleaseRequests.has(group)) return;
    const cacheKey = "codemee-release-" + repo;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      const age = Date.now() - cached?.checkedAt;
      if (!force && age >= 0 && age < releaseRefreshInterval) {
        renderDownloads(group, releaseDownloads(repo, cached.release));
        return;
      }
    } catch { /* Storage and cache contents are optional. */ }
    pendingReleaseRequests.add(group);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`https://api.github.com/repos/codemee/${repo}/releases/latest`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Release request failed");
      const release = await response.json();
      renderDownloads(group, releaseDownloads(repo, release));
      try {
        // Cache only the fields needed to resolve downloads, without credentials.
        const snapshot = { tag_name: release.tag_name, assets: release.assets.map(({ name, browser_download_url }) => ({ name, browser_download_url })) };
        localStorage.setItem(cacheKey, JSON.stringify({ checkedAt: Date.now(), release: snapshot }));
      } catch { /* Downloads also work when browser storage is disabled. */ }
    } catch {
      group.querySelector(".download-status").textContent = text.releaseUnavailable;
    } finally {
      clearTimeout(timeout);
      pendingReleaseRequests.delete(group);
    }
  }
  function refreshToolDownloads(force = false) {
    if (document.hidden) return;
    document.querySelectorAll(".tool-downloads").forEach(group => loadToolDownloads(group, force));
  }
  // Every page load checks GitHub, even if a recent release is already cached.
  document.querySelectorAll(".tool-downloads").forEach(group => loadToolDownloads(group, true));
  setInterval(() => refreshToolDownloads(true), releaseRefreshInterval);
  document.addEventListener("visibilitychange", () => refreshToolDownloads());
  window.addEventListener("focus", () => refreshToolDownloads());
  loadDev();
  loadBlogger();
})();
