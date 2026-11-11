const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const languageScript = fs.readFileSync(path.join(root, "language.js"), "utf8");
const mainScript = fs.readFileSync(path.join(root, "main.js"), "utf8");
const releases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "releases.json"), "utf8"));

function element(extra = {}) {
  return {
    textContent: "", dataset: {}, events: {},
    setAttribute(key, value) { this[key] = value; },
    removeAttribute(key) { delete this[key]; },
    addEventListener(key, action) { this.events[key] = action; },
    ...extra
  };
}

function runLanguage({ browser = "en-US", page = "zh-Hant", href = "https://codemee.github.io/", saved, blocked = false } = {}) {
  const redirects = [], navigations = [], events = {}, lifecycle = {};
  const storage = new Map(saved ? [["codemee-language", saved]] : []);
  const links = ["zh", "en", "auto"].map(language => element({
    dataset: { language },
    href: "https://codemee.github.io/" + (language === "en" ? "en.html" : "index.html") + "?lang=" + language
  }));
  const location = new URL(href);
  location.replace = target => redirects.push(target);
  location.assign = target => navigations.push(target);
  const toggle = element(), symbol = element();
  const summary = { focus() { this.focused = true; } };
  const menu = {
    open: false,
    contains: target => target === menu || target === summary || links.includes(target),
    querySelector: () => summary
  };
  const context = {
    URL, window: { location, addEventListener: (name, action) => { events[name] = action; } },
    navigator: { language: browser, languages: [browser] },
    document: {
      documentElement: { lang: page },
      addEventListener: (name, action) => { lifecycle[name] = action; },
      getElementById: id => ({ "language-toggle": toggle, "language-symbol": symbol, "language-menu": menu })[id],
      querySelectorAll: () => links
    },
    localStorage: {
      getItem(key) { if (blocked) throw Error("Storage disabled"); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw Error("Storage disabled"); storage.set(key, value); },
      removeItem(key) { if (blocked) throw Error("Storage disabled"); storage.delete(key); }
    }
  };
  vm.runInNewContext(languageScript, context);
  lifecycle.DOMContentLoaded();
  return { redirects, navigations, storage, context, events, links, toggle, symbol, menu, summary, lifecycle };
}

test("Chinese browser locales use Traditional Chinese; all other primary locales use English", () => {
  for (const browser of ["zh", "zh-TW", "zh-CN", "zh-Hant-HK"]) {
    assert.equal(runLanguage({ browser }).redirects.length, 0);
    assert.match(runLanguage({ browser, page: "en", href: "https://codemee.github.io/en.html" }).redirects[0], /index\.html$/);
  }
  for (const browser of ["en-US", "ja-JP", "de-DE", "fr-FR", ""]) {
    const first = runLanguage({ browser });
    assert.match(first.redirects[0], /en\.html$/);
    assert.equal(runLanguage({ browser, page: "en", href: first.redirects[0] }).redirects.length, 0);
  }
});

test("manual language choices override the browser and persist across pages", () => {
  const english = runLanguage({ browser: "zh-TW", href: "https://codemee.github.io/?lang=en#feditor" });
  assert.equal(english.storage.get("codemee-language"), "en");
  assert.equal(english.redirects[0], "https://codemee.github.io/en.html?lang=en#feditor");
  assert.equal(runLanguage({ browser: "zh-TW", saved: "en" }).redirects[0], "https://codemee.github.io/en.html");
  const chinese = runLanguage({ browser: "en-US", saved: "en", href: "https://codemee.github.io/?lang=zh" });
  assert.equal(chinese.storage.get("codemee-language"), "zh");
  assert.equal(chinese.redirects.length, 0);
});

test("Auto clears manual preference and follows browser language changes", () => {
  const state = runLanguage({ browser: "zh-TW", saved: "en", href: "https://codemee.github.io/?lang=auto#tools" });
  assert.equal(state.storage.has("codemee-language"), false);
  assert.equal(state.links.find(link => link.dataset.language === "auto")["aria-current"], "true");
  state.context.navigator.language = "ja-JP";
  state.events.languagechange();
  assert.equal(state.redirects[0], "https://codemee.github.io/en.html?lang=auto#tools");
  const manual = runLanguage({ browser: "zh-TW", saved: "zh" });
  manual.context.navigator.language = "en-US";
  manual.events.languagechange();
  assert.equal(manual.redirects.length, 0);
});

test("language URLs work with storage disabled and preserve the current section", () => {
  const state = runLanguage({ browser: "zh-TW", blocked: true, href: "https://codemee.github.io/?lang=en#tools" });
  assert.equal(state.redirects[0], "https://codemee.github.io/en.html?lang=en#tools");
  state.context.window.location.hash = "#contact";
  const link = state.links.find(item => item.dataset.language === "zh");
  link.events.click();
  assert.equal(link.href, "https://codemee.github.io/index.html?lang=zh#contact");
  assert.match(runLanguage({ href: "https://codemee.github.io/?lang=invalid" }).redirects[0], /en\.html\?lang=invalid$/);
});

test("status button shows the chosen mode and cycles Auto, Chinese, English", () => {
  const automatic = runLanguage({ browser: "zh-TW" });
  assert.match(automatic.toggle["aria-label"], /跟隨瀏覽器/);
  automatic.toggle.events.click();
  assert.equal(automatic.navigations[0], "https://codemee.github.io/index.html?lang=zh");
  const chinese = runLanguage({ browser: "en-US", saved: "zh" });
  assert.equal(chinese.symbol.textContent, "中");
  chinese.toggle.events.click();
  assert.equal(chinese.navigations[0], "https://codemee.github.io/en.html?lang=en");
  const english = runLanguage({ browser: "zh-TW", page: "en", saved: "en", href: "https://codemee.github.io/en.html?ref=test&lang=en#feditor" });
  assert.equal(english.symbol.textContent, "En");
  assert.match(english.toggle["aria-label"], /Language: English.*Follow browser/);
  english.toggle.events.click();
  assert.equal(english.navigations[0], "https://codemee.github.io/index.html?ref=test&lang=auto#feditor");
});

test("dropdown closes after selection, outside click, and Escape, restoring keyboard focus", () => {
  const state = runLanguage();
  state.menu.open = true;
  state.lifecycle.click({ target: state.links[0] });
  assert.equal(state.menu.open, true);
  state.lifecycle.click({ target: {} });
  assert.equal(state.menu.open, false);
  state.menu.open = true;
  state.lifecycle.keydown({ key: "Escape" });
  assert.equal(state.menu.open, false);
  assert.equal(state.summary.focused, true);
  state.menu.open = true;
  state.links.find(link => link.dataset.language === "en").events.click();
  assert.equal(state.menu.open, false);
});

async function runMain(language, offline = false, savedTheme = null, blocked = false, cachedRelease = null, settings = {}) {
  const theme = element(), themeSymbol = element(), status = element(), lifecycle = {};
  const intervals = [], windowEvents = {}, clock = { now: Date.now() };
  const releaseState = { tag: "v9.0.0", offline, requests: 0, wait: null };
  class TestDate extends Date { static now() { return clock.now; } }
  const storage = new Map(savedTheme ? [["codemee-theme", savedTheme]] : []);
  const repo = settings.repo || "feditor";
  if (cachedRelease) storage.set("codemee-release-" + repo, JSON.stringify({ checkedAt: clock.now, release: cachedRelease }));
  const options = ["system", "light", "dark"].map(themeOption => element({ dataset: { themeOption } }));
  const summary = { focus() { this.focused = true; } };
  const themeMenu = { open: false, querySelector: () => summary, contains: target => target === summary || options.includes(target) };
  const links = { exe: element({ href: "previous-exe", dataset: { extension: repo === "feditor" || repo === "mvapp" ? "exe" : "zip" } }), dmg: settings.windowsOnly ? null : element({ href: "previous-dmg" }) };
  const group = { dataset: { repo, tool: settings.tool || "FEditor" }, querySelector: selector => selector === ".download-status" ? status : links[selector.includes("windows") ? "exe" : "dmg"] };
  const cards = {};
  for (const id of ["dev-article", "blogger-article"]) {
    const card = { link: element(), time: element(), status: element() };
    card.querySelector = selector => selector === ".post-link" ? card.link : selector === "time" ? card.time : card.status;
    cards[id] = card;
  }
  const document = {
    hidden: false,
    documentElement: { lang: language, dataset: {}, removeAttribute(key) { if (key === "data-theme") delete this.dataset.theme; } },
    getElementById: id => ({ "theme-toggle": theme, "theme-symbol": themeSymbol, "theme-menu": themeMenu })[id] || cards[id] || element(),
    querySelector: selector => cards[selector.split(" ")[0].slice(1)].status,
    querySelectorAll: selector => selector === "[data-theme-option]" ? options : [group],
    addEventListener: (name, action) => { lifecycle[name] = action; },
    createElement: () => ({ remove() {} }), head: { append() {} }
  };
  const window = { addEventListener: (name, action) => { windowEvents[name] = action; } };
  const context = {
    document, window, URL, Date: TestDate, Intl, AbortController,
    setTimeout: () => 1, clearTimeout() {},
    setInterval: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    localStorage: {
      getItem(key) { if (blocked) throw Error("Disabled storage"); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw Error("Disabled storage"); storage.set(key, value); }
    },
    fetch: async (url, options) => {
      if (url.includes("api.github.com")) {
        releaseState.requests++;
        releaseState.requestedUrl = url;
        releaseState.requestOptions = options;
        if (releaseState.wait) await releaseState.wait;
        if (releaseState.offline) throw Error("Offline");
        return { ok: true, json: async () => settings.release || ({
          tag_name: releaseState.tag,
          assets: [{ name: "feditor-windows-x64.exe", browser_download_url: `https://github.com/codemee/feditor/releases/download/${releaseState.tag}/feditor-windows-x64.exe` }]
        }) };
      }
      if (offline) throw Error("Offline");
      return { ok: true, json: async () => [{ title: "中文文章原題", url: "https://dev.to/codemee/article", published_at: "2026-11-04" }] };
    }
  };
  vm.runInNewContext(mainScript, context);
  await new Promise(resolve => setImmediate(resolve));
  window.__codemeeBloggerLatest({ feed: { entry: [{ title: { $t: "Blogger 原題" }, published: { $t: "2026-11-04" }, link: [{ rel: "alternate", href: "https://meebox.blogspot.com/article" }] }] } });
  return { theme, themeSymbol, status, links, cards, options, themeMenu, summary, lifecycle, document, storage, intervals, windowEvents, clock, releaseState };
}

test("each page load bypasses fresh release caches and the browser HTTP cache", async () => {
  const cached = {
    tag_name: "v8.0.0",
    assets: [{ name: "feditor-windows-x64.exe", browser_download_url: "https://github.com/codemee/feditor/releases/download/v8.0.0/feditor-windows-x64.exe" }]
  };
  for (const language of ["en", "zh-Hant"]) {
    const ui = await runMain(language, false, null, false, cached);
    assert.equal(ui.releaseState.requests, 1);
    assert.equal(ui.releaseState.requestOptions.cache, "no-store");
    assert.match(ui.links.exe.href, /v9\.0\.0/);
    assert.equal(JSON.parse(ui.storage.get("codemee-release-feditor")).release.tag_name, "v9.0.0");
    const failed = await runMain(language, true, null, false, cached);
    assert.equal(failed.releaseState.requests, 1);
    assert.equal(failed.links.exe.href, "previous-exe");
    assert.match(failed.status.textContent, language === "en" ? /Unable to check/ : /暫時無法確認/);
  }
});

test("verified release assets select application ZIPs and retain FEditor EXE downloads", async () => {
  for (const language of ["en", "zh-Hant"]) {
    for (const repo of ["fshot", "repdf", "rgpdf", "picview", "prkit", "feditor", "mvapp"]) {
      const ui = await runMain(language, false, null, false, null, { repo, release: releases[repo], windowsOnly: repo === "mvapp" });
      const extension = repo === "feditor" || repo === "mvapp" ? "exe" : "zip";
      assert.equal(ui.releaseState.requestedUrl, `https://api.github.com/repos/codemee/${repo}/releases/latest`);
      assert.ok(ui.links.exe.href.endsWith("." + extension));
      assert.doesNotMatch(ui.links.exe.href, /licenses|sha256/i);
      assert.equal(ui.links.exe.textContent, "↓ Windows ." + extension);
      assert.equal(ui.links.exe.dataset.extension, extension);
      if (repo === "mvapp") assert.equal(ui.links.dmg, null);
      else assert.ok(ui.links.dmg.href.endsWith(".dmg"));
    }
  }
});

test("ZIP upgrades win over legacy EXEs and ignore source, licenses, checksums, and other architectures", async () => {
  const names = ["repdf-source.zip", "repdf-1-windows-x86_64-licenses.zip", "repdf-1-windows-x86_64.exe", "repdf-1-windows-arm64.zip", "repdf-1-windows-x86_64.zip.sha256", "repdf-1-windows-x86_64.zip"];
  const release = { tag_name: "v1", assets: names.map(name => ({ name, browser_download_url: "https://github.com/codemee/repdf/releases/download/v1/" + name })) };
  const ui = await runMain("en", false, null, false, null, { repo: "repdf", release });
  assert.equal(ui.links.exe.href, "https://github.com/codemee/repdf/releases/download/v1/repdf-1-windows-x86_64.zip");
  assert.equal(ui.links.exe.textContent, "↓ Windows .zip");
  const legacy = await runMain("en", false, null, false, null, { repo: "repdf", release: { ...release, assets: release.assets.filter(asset => asset.name.endsWith(".exe")) } });
  assert.equal(legacy.links.exe.textContent, "↓ Windows .exe");
});

test("mvApp remains Windows-only and automatically follows future ZIP packaging", async () => {
  const ui = await runMain("en", false, null, false, null, {
    repo: "mvapp", tool: "mvApp", windowsOnly: true,
    release: { tag_name: "v2", assets: [
      { name: "mvapp.exe", browser_download_url: "https://github.com/codemee/mvapp/releases/download/v2/mvapp.exe" },
      { name: "mvapp.zip", browser_download_url: "https://github.com/codemee/mvapp/releases/download/v2/mvapp.zip" }
    ] }
  });
  assert.equal(ui.links.exe.href, "https://github.com/codemee/mvapp/releases/download/v2/mvapp.zip");
  assert.equal(ui.links.exe["aria-label"], "Download mvApp for Windows .zip");
  assert.equal(ui.status.textContent, "Latest release v2");
});

test("unexpected download hosts are rejected without replacing existing links", async () => {
  const ui = await runMain("en", false, null, false, null, {
    repo: "mvapp", windowsOnly: true,
    release: { tag_name: "v2", assets: [{ name: "mvapp.exe", browser_download_url: "https://example.com/mvapp.exe" }] }
  });
  assert.equal(ui.links.exe.href, "previous-exe");
  assert.match(ui.status.textContent, /Unable to check/);
});

test("GitHub repository names are case-insensitive while download URL spelling is preserved", async () => {
  const downloadUrl = "https://github.com/CodeMee/mvApp/releases/download/vMixedCase/mvapp.exe";
  for (const language of ["en", "zh-Hant"]) {
    const ui = await runMain(language, false, null, false, null, {
      repo: "mvapp", tool: "mvApp", windowsOnly: true,
      release: { tag_name: "vMixedCase", assets: [{ name: "mvapp.exe", browser_download_url: downloadUrl }] }
    });
    assert.equal(ui.links.exe.href, downloadUrl);
    assert.ok(ui.status.textContent.includes("vMixedCase"));
    assert.equal(JSON.parse(ui.storage.get("codemee-release-mvapp")).release.assets[0].browser_download_url, downloadUrl);
  }
});

test("case-insensitive matching still rejects other owners, repositories, and non-download paths", async () => {
  for (const url of [
    "https://github.com/another-owner/mvApp/releases/download/v1/mvapp.exe",
    "https://github.com/codemee/mvApp-other/releases/download/v1/mvapp.exe",
    "https://github.com/codemee/mvApp/releases/tag/v1/mvapp.exe"
  ]) {
    const ui = await runMain("en", false, null, false, null, {
      repo: "mvapp", windowsOnly: true,
      release: { tag_name: "v1", assets: [{ name: "mvapp.exe", browser_download_url: url }] }
    });
    assert.equal(ui.links.exe.href, "previous-exe");
    assert.match(ui.status.textContent, /Unable to check/);
  }
});

test("release links update automatically every 15 minutes without reloading the page", async () => {
  const ui = await runMain("en");
  assert.equal(ui.intervals.length, 1);
  assert.equal(ui.intervals[0].delay, 15 * 60 * 1000);
  ui.releaseState.tag = "v10.0.0";
  ui.intervals[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.releaseState.requests, 2);
  assert.match(ui.links.exe.href, /v10\.0\.0/);
  assert.equal(ui.status.textContent, "Latest release v10.0.0");
});

test("hidden tabs skip polling, and returning to an expired page refreshes once", async () => {
  const ui = await runMain("en");
  ui.document.hidden = true;
  ui.clock.now += 16 * 60 * 1000;
  ui.intervals[0].callback();
  assert.equal(ui.releaseState.requests, 1);
  ui.releaseState.tag = "v11.0.0";
  ui.document.hidden = false;
  ui.lifecycle.visibilitychange();
  ui.windowEvents.focus();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.releaseState.requests, 2);
  assert.match(ui.links.exe.href, /v11\.0\.0/);
  ui.windowEvents.focus();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.releaseState.requests, 2);
});

test("automatic refresh avoids duplicate requests and recovers after a failed check", async () => {
  const ui = await runMain("zh-Hant");
  let resume;
  ui.releaseState.wait = new Promise(resolve => { resume = resolve; });
  ui.intervals[0].callback();
  ui.intervals[0].callback();
  assert.equal(ui.releaseState.requests, 2);
  ui.releaseState.offline = true;
  resume();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(ui.links.exe.href, /v9\.0\.0/);
  assert.match(ui.status.textContent, /暫時無法確認/);
  ui.releaseState.offline = false;
  ui.releaseState.wait = null;
  ui.releaseState.tag = "v12.0.0";
  ui.intervals[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(ui.links.exe.href, /v12\.0\.0/);
  assert.equal(ui.status.textContent, "最新版本 v12.0.0");
});

test("English dynamic UI covers theme, feeds, release updates, and missing platform downloads", async () => {
  const ui = await runMain("en");
  assert.equal(ui.themeSymbol.textContent, "◐");
  ui.theme.events.click();
  assert.equal(ui.themeSymbol.textContent, "☀");
  assert.equal(ui.theme["aria-label"], "Theme: Light. Switch to Dark.");
  assert.equal(ui.cards["dev-article"].status.textContent, "Latest article updated");
  assert.equal(ui.cards["blogger-article"].status.textContent, "Latest article updated");
  assert.equal(ui.cards["dev-article"].link.textContent, "中文文章原題 ↗");
  assert.equal(ui.status.textContent, "Latest release v9.0.0");
  assert.equal(ui.links.exe["aria-label"], "Download FEditor for Windows .exe");
  assert.equal(ui.links.dmg.textContent, "macOS .dmg not available");
  assert.equal(ui.links.dmg.href, undefined);
});

test("error messages use the page language and existing download links remain usable", async () => {
  for (const language of ["en", "zh-Hant"]) {
    const ui = await runMain(language, true);
    assert.equal(ui.links.exe.href, "previous-exe");
    assert.match(ui.status.textContent, language === "en" ? /Unable to check/ : /暫時無法確認/);
    assert.match(ui.cards["dev-article"].status.textContent, language === "en" ? /Unable to refresh/ : /暫時無法更新/);
    assert.equal(ui.themeSymbol.textContent, "◐");
  }
});

test("theme state button cycles through system, light, and dark and remembers the selection", async () => {
  const ui = await runMain("en");
  for (const [mode, symbol] of [["light", "☀"], ["dark", "☾"], ["system", "◐"]]) {
    ui.theme.events.click();
    assert.equal(ui.themeSymbol.textContent, symbol);
    assert.equal(ui.storage.get("codemee-theme"), mode);
    assert.equal(ui.document.documentElement.dataset.theme, mode === "system" ? undefined : mode);
    assert.equal(ui.options.find(option => option.dataset.themeOption === mode)["aria-pressed"], "true");
    assert.equal(ui.options.filter(option => option["aria-pressed"] === "true").length, 1);
  }
  const restored = await runMain("zh-Hant", false, "dark");
  assert.equal(restored.themeSymbol.textContent, "☾");
  assert.equal(restored.document.documentElement.dataset.theme, "dark");
  assert.match(restored.theme["aria-label"], /深色/);
});

test("theme dropdown selects directly, closes on outside click or Escape, and works without storage", async () => {
  const ui = await runMain("en", false, null, true);
  ui.themeMenu.open = true;
  ui.options.find(option => option.dataset.themeOption === "dark").events.click();
  assert.equal(ui.document.documentElement.dataset.theme, "dark");
  assert.equal(ui.themeSymbol.textContent, "☾");
  assert.equal(ui.themeMenu.open, false);
  assert.equal(ui.summary.focused, true);
  ui.themeMenu.open = true;
  ui.lifecycle.click({ target: ui.summary });
  assert.equal(ui.themeMenu.open, true);
  ui.lifecycle.click({ target: {} });
  assert.equal(ui.themeMenu.open, false);
  ui.themeMenu.open = true;
  ui.lifecycle.keydown({ key: "Escape" });
  assert.equal(ui.themeMenu.open, false);
});

test("both static pages keep all tools, download URLs, images, and contact links", () => {
  const zh = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const en = fs.readFileSync(path.join(root, "en.html"), "utf8");
  const targets = html => [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(targets(en), targets(zh));
  for (const html of [zh, en]) {
    assert.equal((html.match(/class="tool"/g) || []).length, 7);
    assert.equal((html.match(/class="tool-download"/g) || []).length, 13);
    assert.equal((html.match(/data-format="windows"/g) || []).length, 7);
    assert.equal((html.match(/data-format="dmg"/g) || []).length, 6);
    const mvapp = html.match(/<div class="tool" id="mvapp">.*?<\/p>.*?<\/div><\/div><a class="tool-arrow"[^]*?<\/a><\/div>/)?.[0];
    assert.ok(mvapp);
    assert.doesNotMatch(mvapp, /data-format="dmg"/);
    assert.doesNotMatch(html, /All six tools support|六款工具皆支援/);
    assert.ok(html.indexOf('src="language.js"') < html.indexOf('href="style.css"'));
  }
  const untranslated = en.replace(/<a class="post-link"[^>]*>.*?<\/a>/g, "")
    .replace(/<div class="language-control"[\s\S]*?<\/details>\s*<\/div>/g, "");
  assert.doesNotMatch(untranslated, /[\u3400-\u9fff]/);
  assert.match(en, /scriptable JavaScript macros/);
  assert.match(en, /optional <strong>virtual 4K/);
});
