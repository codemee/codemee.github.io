(() => {
  "use strict";
  const modes = ["system", "light", "dark"];
  const labels = { system: "跟隨系統", light: "淺色", dark: "深色" };
  let mode = "system";
  try {
    const saved = localStorage.getItem("codemee-theme");
    if (modes.includes(saved)) mode = saved;
  } catch { /* Storage may be disabled; theme controls still work. */ }
  const button = document.getElementById("theme-toggle");
  function applyTheme() {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = mode;
    document.getElementById("theme-label").textContent = labels[mode];
    const next = modes[(modes.indexOf(mode) + 1) % modes.length];
    button.setAttribute("aria-label", `配色：${labels[mode]}，點擊切換${labels[next]}`);
  }
  applyTheme();
  button.addEventListener("click", () => {
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    applyTheme();
    try { localStorage.setItem("codemee-theme", mode); } catch { /* Optional preference. */ }
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
    card.querySelector(".feed-status").textContent = "已更新最新文章";
  }
  function unavailable(id) {
    document.querySelector(`#${id} .feed-status`).textContent = "暫時無法更新，顯示先前取得的文章";
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
  loadDev();
  loadBlogger();
})();
