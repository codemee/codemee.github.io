const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const languageScript = fs.readFileSync(path.join(root, "language.js"), "utf8");
const mainScript = fs.readFileSync(path.join(root, "main.js"), "utf8");

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
  assert.equal(automatic.symbol.textContent, "🌐");
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

async function runMain(language, offline = false, savedTheme = null, blocked = false) {
  const theme = element(), themeSymbol = element(), status = element(), lifecycle = {};
  const storage = new Map(savedTheme ? [["codemee-theme", savedTheme]] : []);
  const options = ["system", "light", "dark"].map(themeOption => element({ dataset: { themeOption } }));
  const summary = { focus() { this.focused = true; } };
  const themeMenu = { open: false, querySelector: () => summary, contains: target => target === summary || options.includes(target) };
  const links = { exe: element({ href: "previous-exe" }), dmg: element({ href: "previous-dmg" }) };
  const group = { dataset: { repo: "feditor", tool: "FEditor" }, querySelector: selector => selector === ".download-status" ? status : links[selector.includes("exe") ? "exe" : "dmg"] };
  const cards = {};
  for (const id of ["dev-article", "blogger-article"]) {
    const card = { link: element(), time: element(), status: element() };
    card.querySelector = selector => selector === ".post-link" ? card.link : selector === "time" ? card.time : card.status;
    cards[id] = card;
  }
  const document = {
    documentElement: { lang: language, dataset: {}, removeAttribute(key) { if (key === "data-theme") delete this.dataset.theme; } },
    getElementById: id => ({ "theme-toggle": theme, "theme-symbol": themeSymbol, "theme-menu": themeMenu })[id] || cards[id] || element(),
    querySelector: selector => cards[selector.split(" ")[0].slice(1)].status,
    querySelectorAll: selector => selector === "[data-theme-option]" ? options : [group],
    addEventListener: (name, action) => { lifecycle[name] = action; },
    createElement: () => ({ remove() {} }), head: { append() {} }
  };
  const window = {};
  const context = {
    document, window, URL, Date, Intl, AbortController,
    setTimeout: () => 1, clearTimeout() {},
    localStorage: {
      getItem(key) { if (blocked) throw Error("Disabled storage"); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw Error("Disabled storage"); storage.set(key, value); }
    },
    fetch: async url => {
      if (offline) throw Error("Offline");
      return { ok: true, json: async () => url.includes("api.github.com") ? {
        tag_name: "v9.0.0", assets: [{ name: "feditor-windows-x64.exe", browser_download_url: "https://github.com/codemee/feditor/releases/download/v9.0.0/feditor-windows-x64.exe" }]
      } : [{ title: "中文文章原題", url: "https://dev.to/codemee/article", published_at: "2026-11-04" }] };
    }
  };
  vm.runInNewContext(mainScript, context);
  await new Promise(resolve => setImmediate(resolve));
  window.__codemeeBloggerLatest({ feed: { entry: [{ title: { $t: "Blogger 原題" }, published: { $t: "2026-11-04" }, link: [{ rel: "alternate", href: "https://meebox.blogspot.com/article" }] }] } });
  return { theme, themeSymbol, status, links, cards, options, themeMenu, summary, lifecycle, document, storage };
}

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
    assert.equal((html.match(/class="tool"/g) || []).length, 6);
    assert.equal((html.match(/class="tool-download"/g) || []).length, 12);
    assert.ok(html.indexOf('src="language.js"') < html.indexOf('href="style.css"'));
  }
  const untranslated = en.replace(/<a class="post-link"[^>]*>.*?<\/a>/g, "")
    .replace(/<div class="language-control"[\s\S]*?<\/details>\s*<\/div>/g, "");
  assert.doesNotMatch(untranslated, /[\u3400-\u9fff]/);
  assert.match(en, /scriptable JavaScript macros/);
  assert.match(en, /optional <strong>virtual 4K/);
});
