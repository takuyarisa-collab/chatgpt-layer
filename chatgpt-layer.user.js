// ==UserScript==
// @name         ChatGPT Layer Loader
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.8.0
// @description  Merge global, project, and chat layers, apply themes, and provide shared page controls.
// @author       TaC & Shion
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @updateURL    https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.meta.js
// @downloadURL  https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.user.js
// ==/UserScript==

(function () {
  "use strict";

  var LAYER_ID = "chatgpt-layer";
  var SCROLL_BUTTON_ID = LAYER_ID + "-scroll-bottom";
  var RELOAD_BUTTON_ID = LAYER_ID + "-reload";
  var THEME_STYLE_ID = LAYER_ID + "-theme-style";
  var CACHE_KEY = LAYER_ID + ":last-good-config:v6";
  var LAYER_ATTRIBUTE = "data-chatgpt-layer";
  var LAYERS_ATTRIBUTE = "data-chatgpt-layers";
  var PROJECT_ATTRIBUTE = "data-chatgpt-project-id";
  var CHAT_ATTRIBUTE = "data-chatgpt-chat-id";
  var VERSION_ATTRIBUTE = "data-chatgpt-layer-config-version";
  var THEME_ATTRIBUTE = "data-chatgpt-layer-theme";

  var CONFIG_URLS = [
    "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.config.json",
    "https://cdn.jsdelivr.net/gh/takuyarisa-collab/chatgpt-layer@main/chatgpt-layer.config.json"
  ];

  var DEFAULT_CONFIG = {
    version: "builtin-0.8.0",
    global: {},
    projects: {},
    chats: {},
    layers: { default: {} }
  };

  var DEFAULT_THEME = {
    pageBackground: "#100d16",
    surfaceBackground: "#17121f",
    surfaceAltBackground: "#20192b",
    sidebarBackground: "#0c0a11",
    composerBackground: "#1c1626",
    textColor: "#f5f1fa",
    mutedTextColor: "#bdb5ca",
    borderColor: "rgba(168, 139, 250, 0.18)",
    accentColor: "#9f82ff"
  };

  var OWN_THEME_PROPERTIES = [
    "--cgl-page-bg",
    "--cgl-surface-bg",
    "--cgl-surface-alt-bg",
    "--cgl-sidebar-bg",
    "--cgl-composer-bg",
    "--cgl-text",
    "--cgl-muted-text",
    "--cgl-border",
    "--cgl-accent"
  ];

  var CHATGPT_THEME_PROPERTIES = [
    "--main-surface-primary",
    "--main-surface-secondary",
    "--main-surface-tertiary",
    "--sidebar-surface-primary",
    "--sidebar-surface-secondary",
    "--composer-surface-primary",
    "--composer-surface-secondary",
    "--text-primary",
    "--text-secondary",
    "--text-tertiary",
    "--border-light",
    "--border-medium"
  ];

  var activeConfig = DEFAULT_CONFIG;
  var renderScheduled = false;
  var lastContextKey = "";

  function isRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeRecord(value) {
    return isRecord(value) ? value : {};
  }

  function isSafeKey(key) {
    return key !== "__proto__" && key !== "prototype" && key !== "constructor";
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);

    if (isRecord(value)) {
      var copy = {};
      Object.keys(value).forEach(function (key) {
        if (isSafeKey(key)) copy[key] = cloneValue(value[key]);
      });
      return copy;
    }

    return value;
  }

  function hasStableIds(values) {
    return values.every(function (item) {
      return isRecord(item) && typeof item.id === "string" && item.id.length > 0;
    });
  }

  function mergeArrays(base, override) {
    if (!hasStableIds(base) || !hasStableIds(override)) return cloneValue(override);

    var result = base.map(cloneValue);
    var indexes = {};

    result.forEach(function (item, index) {
      indexes[item.id] = index;
    });

    override.forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(indexes, item.id)) {
        var index = indexes[item.id];
        result[index] = mergeValues(result[index], item);
      } else {
        indexes[item.id] = result.length;
        result.push(cloneValue(item));
      }
    });

    return result;
  }

  function mergeValues(base, override) {
    if (Array.isArray(base) && Array.isArray(override)) return mergeArrays(base, override);

    if (isRecord(base) && isRecord(override)) {
      var result = cloneValue(base);
      Object.keys(override).forEach(function (key) {
        if (!isSafeKey(key)) return;
        result[key] = Object.prototype.hasOwnProperty.call(result, key)
          ? mergeValues(result[key], override[key])
          : cloneValue(override[key]);
      });
      return result;
    }

    return cloneValue(override);
  }

  function normalizeLayerSelection(value, layers) {
    var candidates = [];

    if (typeof value === "string") candidates = [value];
    else if (Array.isArray(value)) candidates = value;
    else if (isRecord(value)) {
      if (typeof value.layer === "string") candidates.push(value.layer);
      if (Array.isArray(value.layers)) candidates = candidates.concat(value.layers);
    }

    var seen = {};
    return candidates.filter(function (layerName) {
      if (typeof layerName !== "string") return false;
      if (!layers[layerName] || seen[layerName]) return false;
      seen[layerName] = true;
      return true;
    });
  }

  function validateConfig(value) {
    if (!isRecord(value)) throw new Error("設定ファイルの形式が不正です。");

    var rawLayers = normalizeRecord(value.layers);
    var layers = {};

    Object.keys(rawLayers).forEach(function (layerName) {
      if (/^[a-z0-9_-]+$/i.test(layerName)) {
        layers[layerName] = cloneValue(normalizeRecord(rawLayers[layerName]));
      }
    });

    if (!layers.default) layers.default = {};

    var projects = {};
    Object.keys(normalizeRecord(value.projects)).forEach(function (projectId) {
      if (!/^g-p-[a-z0-9]+$/i.test(projectId)) return;
      var selection = normalizeLayerSelection(value.projects[projectId], layers);
      if (selection.length) projects[projectId] = selection;
    });

    var chats = {};
    Object.keys(normalizeRecord(value.chats)).forEach(function (chatId) {
      if (!/^[a-z0-9-]{8,128}$/i.test(chatId)) return;
      var selection = normalizeLayerSelection(value.chats[chatId], layers);
      if (selection.length) chats[chatId] = selection;
    });

    return {
      version: String(value.version || "unknown"),
      global: mergeValues(normalizeRecord(value.base), normalizeRecord(value.global)),
      projects: projects,
      chats: chats,
      layers: layers
    };
  }

  function requestWithLegacyGM(url) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        headers: { "Cache-Control": "no-cache" },
        timeout: 10000,
        onload: function (response) {
          if (response.status >= 200 && response.status < 300) resolve(response.responseText);
          else reject(new Error("HTTP " + response.status));
        },
        onerror: function () { reject(new Error("network error")); },
        ontimeout: function () { reject(new Error("timeout")); }
      });
    });
  }

  async function requestText(url) {
    var target = url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();

    try {
      var response = await fetch(target, { cache: "no-store", credentials: "omit" });
      if (response.ok) return response.text();
    } catch (error) {
      // Try Userscript APIs next.
    }

    if (typeof GM_xmlhttpRequest === "function") return requestWithLegacyGM(target);

    if (globalThis.GM && typeof globalThis.GM.xmlHttpRequest === "function") {
      var gmResponse = await globalThis.GM.xmlHttpRequest({
        method: "GET",
        url: target,
        headers: { "Cache-Control": "no-cache" },
        timeout: 10000
      });
      if (gmResponse.status >= 200 && gmResponse.status < 300) return gmResponse.responseText;
      throw new Error("HTTP " + gmResponse.status);
    }

    throw new Error("利用できる通信手段がありません。");
  }

  async function loadRemoteConfig() {
    var lastError = null;

    for (var index = 0; index < CONFIG_URLS.length; index += 1) {
      try {
        return validateConfig(JSON.parse(await requestText(CONFIG_URLS[index])));
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("設定を取得できませんでした。");
  }

  function readCachedConfig() {
    try {
      var text = localStorage.getItem(CACHE_KEY);
      return text ? validateConfig(JSON.parse(text)) : null;
    } catch (error) {
      return null;
    }
  }

  function writeCachedConfig(config) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(config));
    } catch (error) {
      // Continue without a cache.
    }
  }

  function getProjectId(pathname) {
    var path = pathname || location.pathname;
    var match = path.match(/^\/g\/(g-p-[a-z0-9]{16,64})(?:-[^/]+)?(?:\/|$)/i);
    return match ? match[1] : null;
  }

  function getChatId(pathname) {
    var path = pathname || location.pathname;
    var match = path.match(/\/c\/([a-z0-9-]{8,128})(?:\/|$)/i);
    return match ? match[1] : null;
  }

  function appendUnique(target, values) {
    values.forEach(function (value) {
      if (target.indexOf(value) < 0) target.push(value);
    });
  }

  function resolveContext(config) {
    var projectId = getProjectId();
    var chatId = getChatId();
    var layerNames = [];

    appendUnique(layerNames, projectId ? config.projects[projectId] || [] : []);
    appendUnique(layerNames, chatId ? config.chats[chatId] || [] : []);
    if (!layerNames.length) layerNames.push("default");

    var settings = cloneValue(config.global);
    layerNames.forEach(function (layerName) {
      settings = mergeValues(settings, config.layers[layerName] || {});
    });

    return {
      configVersion: config.version,
      projectId: projectId,
      chatId: chatId,
      layerNames: layerNames,
      layerName: layerNames[layerNames.length - 1],
      settings: settings
    };
  }

  function normalizeColor(value, fallback) {
    if (typeof value !== "string") return fallback;
    var candidate = value.trim();
    if (!candidate) return fallback;
    if (globalThis.CSS && typeof globalThis.CSS.supports === "function") {
      if (!globalThis.CSS.supports("color", candidate)) return fallback;
    }
    return candidate;
  }

  function normalizeTheme(value) {
    if (!isRecord(value) || value.enabled === false) return null;

    return {
      pageBackground: normalizeColor(value.pageBackground, DEFAULT_THEME.pageBackground),
      surfaceBackground: normalizeColor(value.surfaceBackground, DEFAULT_THEME.surfaceBackground),
      surfaceAltBackground: normalizeColor(value.surfaceAltBackground, DEFAULT_THEME.surfaceAltBackground),
      sidebarBackground: normalizeColor(value.sidebarBackground, DEFAULT_THEME.sidebarBackground),
      composerBackground: normalizeColor(value.composerBackground, DEFAULT_THEME.composerBackground),
      textColor: normalizeColor(value.textColor, DEFAULT_THEME.textColor),
      mutedTextColor: normalizeColor(value.mutedTextColor, DEFAULT_THEME.mutedTextColor),
      borderColor: normalizeColor(value.borderColor, DEFAULT_THEME.borderColor),
      accentColor: normalizeColor(value.accentColor, DEFAULT_THEME.accentColor)
    };
  }

  function ensureThemeStyle() {
    if (!document.head || document.getElementById(THEME_STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = THEME_STYLE_ID;
    style.textContent =
      'html[' + THEME_ATTRIBUTE + '="on"], html[' + THEME_ATTRIBUTE + '="on"] body, html[' + THEME_ATTRIBUTE + '="on"] #__next {' +
      'background-color:var(--cgl-page-bg)!important;color:var(--cgl-text)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] main, html[' + THEME_ATTRIBUTE + '="on"] [role="main"], html[' + THEME_ATTRIBUTE + '="on"] [class*="bg-token-main-surface-primary"] {' +
      'background-color:var(--cgl-page-bg)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] [class*="bg-token-main-surface-secondary"] {' +
      'background-color:var(--cgl-surface-bg)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] [class*="bg-token-main-surface-tertiary"] {' +
      'background-color:var(--cgl-surface-alt-bg)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] nav, html[' + THEME_ATTRIBUTE + '="on"] aside, html[' + THEME_ATTRIBUTE + '="on"] [class*="bg-token-sidebar-surface-primary"] {' +
      'background-color:var(--cgl-sidebar-bg)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] [class*="bg-token-sidebar-surface-secondary"] {' +
      'background-color:var(--cgl-surface-bg)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] [class*="bg-token-composer-surface-primary"], html[' + THEME_ATTRIBUTE + '="on"] form:has(#prompt-textarea), html[' + THEME_ATTRIBUTE + '="on"] div:has(> #prompt-textarea), html[' + THEME_ATTRIBUTE + '="on"] div:has(> div > #prompt-textarea) {' +
      'background-color:var(--cgl-composer-bg)!important;border-color:var(--cgl-border)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] #prompt-textarea {' +
      'color:var(--cgl-text)!important;caret-color:var(--cgl-accent)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] #prompt-textarea::placeholder {' +
      'color:var(--cgl-muted-text)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] pre, html[' + THEME_ATTRIBUTE + '="on"] code {' +
      'border-color:var(--cgl-border)!important;}';

    document.head.appendChild(style);
  }

  function clearTheme(root) {
    root.removeAttribute(THEME_ATTRIBUTE);
    OWN_THEME_PROPERTIES.concat(CHATGPT_THEME_PROPERTIES).forEach(function (property) {
      root.style.removeProperty(property);
    });
  }

  function applyTheme(value) {
    var root = document.documentElement;
    if (!root) return;

    var theme = normalizeTheme(value);
    if (!theme) {
      clearTheme(root);
      return;
    }

    ensureThemeStyle();
    root.setAttribute(THEME_ATTRIBUTE, "on");

    var variables = {
      "--cgl-page-bg": theme.pageBackground,
      "--cgl-surface-bg": theme.surfaceBackground,
      "--cgl-surface-alt-bg": theme.surfaceAltBackground,
      "--cgl-sidebar-bg": theme.sidebarBackground,
      "--cgl-composer-bg": theme.composerBackground,
      "--cgl-text": theme.textColor,
      "--cgl-muted-text": theme.mutedTextColor,
      "--cgl-border": theme.borderColor,
      "--cgl-accent": theme.accentColor,
      "--main-surface-primary": theme.pageBackground,
      "--main-surface-secondary": theme.surfaceBackground,
      "--main-surface-tertiary": theme.surfaceAltBackground,
      "--sidebar-surface-primary": theme.sidebarBackground,
      "--sidebar-surface-secondary": theme.surfaceBackground,
      "--composer-surface-primary": theme.composerBackground,
      "--composer-surface-secondary": theme.surfaceAltBackground,
      "--text-primary": theme.textColor,
      "--text-secondary": theme.mutedTextColor,
      "--text-tertiary": theme.mutedTextColor,
      "--border-light": theme.borderColor,
      "--border-medium": theme.borderColor
    };

    Object.keys(variables).forEach(function (property) {
      root.style.setProperty(property, variables[property], "important");
    });
  }

  function findScrollContainer() {
    var turns = document.querySelectorAll(
      'article[data-testid^="conversation-turn"], [data-message-author-role]'
    );
    var lastTurn = turns.length ? turns[turns.length - 1] : null;
    var anchors = [
      lastTurn,
      document.querySelector("#prompt-textarea"),
      document.querySelector("main"),
      document.querySelector('[role="main"]')
    ];

    for (var anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
      var element = anchors[anchorIndex];
      while (element && element !== document.documentElement) {
        if (
          element instanceof Element &&
          element.clientHeight > 0 &&
          element.scrollHeight > element.clientHeight + 8
        ) {
          var overflowY = getComputedStyle(element).overflowY;
          if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
            return element;
          }
        }
        element = element.parentElement;
      }
    }

    return document.scrollingElement || document.documentElement;
  }

  function performScrollToBottom() {
    var nativeButton = document.querySelector(
      'button[data-testid="scroll-to-bottom-button"], button[aria-label="Scroll to bottom"], button[aria-label="一番下までスクロール"]'
    );

    if (nativeButton && typeof nativeButton.click === "function") nativeButton.click();

    var target = findScrollContainer();
    var isDocumentTarget =
      target === document.scrollingElement ||
      target === document.documentElement ||
      target === document.body;

    if (isDocumentTarget) {
      var bodyHeight = document.body ? document.body.scrollHeight : 0;
      window.scrollTo(0, Math.max(document.documentElement.scrollHeight, bodyHeight));
    } else {
      target.scrollTop = target.scrollHeight;
    }
  }

  function scrollToBottom() {
    performScrollToBottom();
    requestAnimationFrame(performScrollToBottom);
    window.setTimeout(performScrollToBottom, 120);
  }

  function getEditorText() {
    var editor = document.querySelector(
      '#prompt-textarea, textarea[data-id="root"], form textarea, form [contenteditable="true"]'
    );

    if (!editor) return "";
    if (typeof editor.value === "string") return editor.value.trim();
    return String(editor.innerText || editor.textContent || "").trim();
  }

  function reloadPage() {
    if (getEditorText() && !window.confirm("入力中の文章があります。ページを再読み込みしますか？")) {
      return;
    }
    window.location.reload();
  }

  function setImportant(style, property, value) {
    style.setProperty(property, value, "important");
  }

  function applyButtonStyle(button, right, fontSize) {
    var style = button.style;
    setImportant(style, "position", "fixed");
    setImportant(style, "top", "auto");
    setImportant(style, "left", "auto");
    setImportant(style, "right", right + "px");
    setImportant(style, "bottom", "120px");
    setImportant(style, "z-index", "2147483647");
    setImportant(style, "box-sizing", "border-box");
    setImportant(style, "display", "grid");
    setImportant(style, "place-items", "center");
    setImportant(style, "width", "40px");
    setImportant(style, "min-width", "40px");
    setImportant(style, "max-width", "40px");
    setImportant(style, "height", "40px");
    setImportant(style, "min-height", "40px");
    setImportant(style, "max-height", "40px");
    setImportant(style, "margin", "0");
    setImportant(style, "padding", "0");
    setImportant(style, "border", "1.5px solid rgba(255,255,255,0.82)");
    setImportant(style, "border-radius", "999px");
    setImportant(style, "background", "#7c3aed");
    setImportant(style, "color", "#ffffff");
    setImportant(style, "box-shadow", "0 4px 16px rgba(0,0,0,0.48)");
    setImportant(style, "font-family", "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
    setImportant(style, "font-size", fontSize + "px");
    setImportant(style, "font-weight", "800");
    setImportant(style, "line-height", "1");
    setImportant(style, "text-align", "center");
    setImportant(style, "opacity", "1");
    setImportant(style, "visibility", "visible");
    setImportant(style, "overflow", "visible");
    setImportant(style, "pointer-events", "auto");
    setImportant(style, "transform", "none");
    setImportant(style, "appearance", "none");
    setImportant(style, "-webkit-appearance", "none");
    setImportant(style, "touch-action", "manipulation");
    setImportant(style, "-webkit-tap-highlight-color", "transparent");
  }

  function ensureActionButton(id, label, ariaLabel, right, fontSize, onClick) {
    if (!document.body) return null;

    var button = document.getElementById(id);
    if (!button) {
      button = document.createElement("button");
      button.id = id;
      button.type = "button";
      document.body.appendChild(button);
    } else if (button.parentElement !== document.body) {
      document.body.appendChild(button);
    }

    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.setAttribute("title", ariaLabel);
    button.hidden = false;
    button.disabled = false;
    button.removeAttribute("aria-hidden");
    button.onclick = onClick;
    applyButtonStyle(button, right, fontSize);
    return button;
  }

  function ensureSharedButtons() {
    ensureActionButton(RELOAD_BUTTON_ID, "↻", "ページを再読み込みする", 64, 20, reloadPage);
    ensureActionButton(SCROLL_BUTTON_ID, "↓", "一番下までスクロールする", 16, 21, scrollToBottom);
  }

  function applyContext(context) {
    var root = document.documentElement;
    if (!root) return;

    root.setAttribute(LAYER_ATTRIBUTE, context.layerName);
    root.setAttribute(LAYERS_ATTRIBUTE, context.layerNames.join(" "));
    root.setAttribute(VERSION_ATTRIBUTE, context.configVersion);

    if (context.projectId) root.setAttribute(PROJECT_ATTRIBUTE, context.projectId);
    else root.removeAttribute(PROJECT_ATTRIBUTE);

    if (context.chatId) root.setAttribute(CHAT_ATTRIBUTE, context.chatId);
    else root.removeAttribute(CHAT_ATTRIBUTE);

    applyTheme(context.settings.theme);
    ensureSharedButtons();

    var contextKey =
      context.configVersion + ":" +
      (context.projectId || "none") + ":" +
      (context.chatId || "none") + ":" +
      context.layerNames.join(",");

    if (contextKey !== lastContextKey) {
      lastContextKey = contextKey;
      console.info("[ChatGPT Layer] Active layers", {
        projectId: context.projectId,
        chatId: context.chatId,
        layers: context.layerNames,
        topLayer: context.layerName,
        configVersion: context.configVersion,
        settings: context.settings
      });
    }
  }

  function render() {
    applyContext(resolveContext(activeConfig));
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(function () {
      renderScheduled = false;
      render();
    });
  }

  function observeNavigation() {
    ["pushState", "replaceState"].forEach(function (methodName) {
      var original = history[methodName];
      if (typeof original !== "function") return;

      history[methodName] = function () {
        var result = original.apply(this, arguments);
        scheduleRender();
        return result;
      };
    });

    window.addEventListener("popstate", scheduleRender);
    window.addEventListener("hashchange", scheduleRender);
    new MutationObserver(scheduleRender).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  async function start() {
    activeConfig = readCachedConfig() || DEFAULT_CONFIG;
    render();
    observeNavigation();

    try {
      activeConfig = await loadRemoteConfig();
      writeCachedConfig(activeConfig);
      render();
    } catch (error) {
      console.warn("[ChatGPT Layer] Remote config load failed.", error);
      activeConfig = DEFAULT_CONFIG;
      render();
    }
  }

  start();
})();
