(() => {
  "use strict";
  const isOverlayPath = path => path === "/profile" || path === "/voice-video" || path === "/sessions" || path === "/search" || path.startsWith("/admin/");
  const style = document.createElement("style");
  style.textContent = `.app-overlay{position:fixed;inset:0;z-index:100;background:var(--bg-main);overflow:auto}.app-overlay>.app-shell{min-height:100vh}.app-overlay-close{position:fixed;top:18px;right:22px;z-index:102;width:40px;height:40px;min-height:40px;padding:0;border:1px solid var(--border);border-radius:50%;background:var(--bg-active);color:var(--muted);font-size:1.8rem;line-height:1}.app-overlay-close:hover{color:var(--text);background:var(--bg-hover)}body.app-overlay-open{overflow:hidden}`;
  document.head.append(style);
  let overlay = null;
  let baseURL = location.href;

  const load = async url => {
    const response = await fetch(url, {headers: {Accept: "text/html"}, credentials: "same-origin"});
    if (!response.ok) throw new Error(`Navigation failed (${response.status})`);
    return new DOMParser().parseFromString(await response.text(), "text/html");
  };
  const syncStyles = next => Promise.all([...next.querySelectorAll('link[rel="stylesheet"][href]')].map(source => {
    const href = new URL(source.getAttribute("href"), location.href).href;
    if ([...document.styleSheets].some(sheet => sheet.href === href)) return Promise.resolve();
    return new Promise(resolve => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = source.getAttribute("href");
      link.onload = link.onerror = resolve;
      document.head.append(link);
    });
  }));
  const syncBody = next => {
    for (const name of ["channelId", "memberId", "lastSequence"]) next.body.dataset[name] === undefined ? delete document.body.dataset[name] : document.body.dataset[name] = next.body.dataset[name];
    document.title = next.title;
  };
  const installRuntime = next => {
    document.querySelectorAll("script[data-channel-runtime]").forEach(script => script.remove());
    next.querySelectorAll("body > script:not([src])").forEach(source => {
      const script = document.createElement("script");
      script.dataset.channelRuntime = "";
      script.textContent = source.textContent;
      document.body.append(script);
    });
  };
  const closeOverlay = ({restoreURL = true} = {}) => {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.body.classList.remove("app-overlay-open");
    if (restoreURL) history.pushState({allchatView: true}, "", baseURL);
  };
  const showOverlay = (next, url, {push = true} = {}) => {
    if (!overlay) {
      baseURL = location.href;
      overlay = document.createElement("section");
      overlay.className = "app-overlay";
      overlay.dataset.appOverlay = "";
      overlay.setAttribute("aria-label", "Settings");
      document.body.append(overlay);
    }
    const shell = next.querySelector(".app-shell");
    if (!shell) throw new Error("Settings response has no app shell");
    const imported = document.importNode(shell, true);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "app-overlay-close";
    close.dataset.overlayClose = "";
    close.setAttribute("aria-label", "Close settings");
    close.textContent = "×";
    imported.append(close);
    overlay.replaceChildren(imported);
    document.body.classList.add("app-overlay-open");
    document.title = next.title;
    document.dispatchEvent(new CustomEvent("allchat:view-swapped", {detail: {root: overlay}}));
    if (push) history.pushState({allchatOverlay: true}, "", url);
  };
  const preserveVoicePanel = sidebar => {
    const panel = document.querySelector(".voice-connection-panel");
    if (!panel || !sidebar) return;
    const anchor = sidebar.querySelector(".member-panel, .sidebar-footer");
    anchor ? anchor.before(panel) : sidebar.append(panel);
  };
  const showView = (next, url, {push = true} = {}) => {
    closeOverlay({restoreURL: false});
    document.dispatchEvent(new CustomEvent("allchat:before-conversation-swap"));
    const currentContent = document.querySelector(".content-shell");
    const nextContent = next.querySelector(".content-shell");
    if (!currentContent || !nextContent) throw new Error("Response has no content region");
    const callPanel = currentContent.querySelector(".call-banner");
    if (!new URL(url, location.href).pathname.startsWith("/channels/")) {
      const currentRail = document.querySelector(".community-rail"), nextRail = next.querySelector(".community-rail");
      const currentSidebar = document.querySelector(".channel-sidebar"), nextSidebar = next.querySelector(".channel-sidebar");
      if (currentRail && nextRail) currentRail.replaceWith(document.importNode(nextRail, true));
      if (currentSidebar && nextSidebar) {
        const sidebar = document.importNode(nextSidebar, true);
        preserveVoicePanel(sidebar);
        currentSidebar.replaceWith(sidebar);
      }
    }
    const importedContent = document.importNode(nextContent, true);
    if (callPanel && !callPanel.hidden) {
      const header = importedContent.querySelector(".content-header");
      header ? header.after(callPanel) : importedContent.prepend(callPanel);
    }
    currentContent.replaceWith(importedContent);
    syncBody(next);
    installRuntime(next);
    document.dispatchEvent(new CustomEvent("allchat:view-swapped"));
    if (push) history.pushState({allchatView: true}, "", url);
    baseURL = url;
  };
  const render = (next, url, options = {}) => {
    isOverlayPath(new URL(url, location.href).pathname) ? showOverlay(next, url, options) : showView(next, url, options);
  };
  const navigate = async (url, options = {}) => {
    const next = await load(url);
    await syncStyles(next);
    render(next, url, options);
  };
  window.allchatNavigate = navigate;

  document.addEventListener("click", event => {
    if (event.target.closest("[data-overlay-close]")) {
      event.preventDefault();
      closeOverlay();
      return;
    }
    const link = event.target.closest("a[href]");
    if (!link || !link.closest(".app-shell") || link.matches(".voice-link") || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (link.closest("[data-app-overlay]") && url.pathname === "/") {
      event.preventDefault();
      closeOverlay();
      return;
    }
    if (url.origin !== location.origin || (!url.pathname.startsWith("/channels/") && url.pathname !== "/" && url.pathname !== "/dms" && !isOverlayPath(url.pathname))) return;
    event.preventDefault();
    navigate(url.href).catch(() => location.assign(url.href));
  });
  document.addEventListener("submit", async event => {
    if (event.defaultPrevented) return;
    const form = event.target.closest("form");
    if (!form?.closest(".app-shell") || form.target || form.action.endsWith("/logout")) return;
    const method = (form.method || "get").toUpperCase();
    if (method !== "GET" && method !== "POST") return;
    event.preventDefault();
    const data = new FormData(form, event.submitter);
    let url = new URL(form.action || location.href, location.href);
    const options = {method, credentials: "same-origin", headers: {Accept: "text/html"}};
    if (method === "GET") url.search = new URLSearchParams(data).toString();
    else options.body = data;
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`Form submission failed (${response.status})`);
      const next = new DOMParser().parseFromString(await response.text(), "text/html");
      render(next, response.url || url.href);
    } catch (_) {
      form.submit();
    }
  });
  addEventListener("popstate", () => {
    if (overlay && location.href === baseURL) closeOverlay({restoreURL: false});
    else navigate(location.href, {push: false}).catch(() => location.reload());
  });
})();
