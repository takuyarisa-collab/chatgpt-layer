// ==UserScript==
// @name         ChatGPT Layer Loader
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.10.0
// @description  Merge global, project, and chat layers, apply JSON themes, style the composer, and render layer actions.
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
  var ACTION_BUTTON_PREFIX = LAYER_ID + "-action-";
  var ACTION_ATTRIBUTE = "data-chatgpt-layer-action-id";
  var COMPOSER_SURFACE_ATTRIBUTE = "data-chatgpt-layer-composer-surface";
  var TOAST_ID = LAYER_ID + "-toast";
  var THEME_STYLE_ID = LAYER_ID + "-theme-style";
  var CACHE_KEY = LAYER_ID + ":last-good-config:v8";
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
    version: "builtin-0.10.0",
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

  var DEFAULT_BUTTON_STYLE = {
    size: 40,
    fontSize: 18,
    background: "#7c3aed",
    color: "#ffffff",
    borderColor: "rgba(255,255,255,0.82)"
  };

  var DEFAULT_LAYER_BUTTON_STYLE = {
    size: 40,
    fontSize: 16,
    background: "#5f2f64",
    color: "#ffffff",
    borderColor: "rgba(255,255,255,0.82)"
  };

  var OWN_THEME_PROPERTIES = [
    "--cgl-page-bg",
    "--cgl-surface-bg",
    "--cgl-surface-alt-bg",
    "--cgl-sidebar-bg",
    "--cgl-composer-bg",
    "--cgl-composer-background-image",
    "--cgl-composer-background-size",
    "--cgl-composer-background-position",
    "--cgl-composer-background-blend",
    "--cgl-composer-box-shadow",
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

  function clampNumber(value, fallback, minimum, maximum) {
    var number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function normalizeGradient(value, composerBackground) {
    if (!isRecord(value) || value.enabled === false) return null;
    return {
      angle: clampNumber(value.angle, 180, -360, 360),
      from: normalizeColor(value.from, composerBackground),
      to: normalizeColor(value.to, composerBackground)
    };
  }

  function normalizeComposerShadow(value) {
    if (!isRecord(value) || value.enabled === false) return null;
    return {
      color: normalizeColor(value.color, "rgba(0,0,0,0.42)"),
      x: clampNumber(value.x, 0, -40, 40),
      y: clampNumber(value.y, 10, -40, 40),
      blur: clampNumber(value.blur, 24, 0, 80),
      spread: clampNumber(value.spread, -8, -40, 40)
    };
  }

  function normalizeComposerHighlight(value) {
    if (!isRecord(value) || value.enabled === false) return null;
    return {
      color: normalizeColor(value.color, "rgba(255,255,255,0.12)"),
      size: clampNumber(value.size, 1, 0, 4)
    };
  }

  function normalizeComposerTexture(value) {
    if (!isRecord(value) || value.enabled === false) return null;

    var type = typeof value.type === "string" ? value.type : "grain";
    if (["grain", "linen", "wood"].indexOf(type) < 0) type = "grain";

    var blendMode = typeof value.blendMode === "string" ? value.blendMode : "soft-light";
    if (["normal", "soft-light", "overlay", "multiply", "screen"].indexOf(blendMode) < 0) {
      blendMode = "soft-light";
    }

    return {
      type: type,
      color: normalizeColor(value.color, "rgba(255,255,255,0.035)"),
      size: clampNumber(value.size, 6, 2, 32),
      blendMode: blendMode
    };
  }

  function normalizeComposerStyle(value, composerBackground) {
    if (!isRecord(value) || value.enabled === false) return null;

    return {
      gradient: normalizeGradient(value.gradient, composerBackground),
      shadow: normalizeComposerShadow(value.shadow),
      highlight: normalizeComposerHighlight(value.highlight),
      texture: normalizeComposerTexture(value.texture)
    };
  }

  function normalizeTheme(value) {
    if (!isRecord(value) || value.enabled === false) return null;

    var composerBackground = normalizeColor(value.composerBackground, DEFAULT_THEME.composerBackground);

    return {
      pageBackground: normalizeColor(value.pageBackground, DEFAULT_THEME.pageBackground),
      surfaceBackground: normalizeColor(value.surfaceBackground, DEFAULT_THEME.surfaceBackground),
      surfaceAltBackground: normalizeColor(value.surfaceAltBackground, DEFAULT_THEME.surfaceAltBackground),
      sidebarBackground: normalizeColor(value.sidebarBackground, DEFAULT_THEME.sidebarBackground),
      composerBackground: composerBackground,
      composerStyle: normalizeComposerStyle(value.composerStyle, composerBackground),
      textColor: normalizeColor(value.textColor, DEFAULT_THEME.textColor),
      mutedTextColor: normalizeColor(value.mutedTextColor, DEFAULT_THEME.mutedTextColor),
      borderColor: normalizeColor(value.borderColor, DEFAULT_THEME.borderColor),
      accentColor: normalizeColor(value.accentColor, DEFAULT_THEME.accentColor)
    };
  }

  function buildTextureLayers(texture) {
    if (!texture) return [];

    var color = texture.color;
    var size = texture.size;
    var layers = [];

    if (texture.type === "grain") {
      layers.push({
        image: "radial-gradient(circle, " + color + " 0, " + color + " 0.6px, transparent 0.8px)",
        size: size + "px " + size + "px",
        position: "0 0",
        blend: texture.blendMode
      });
    } else if (texture.type === "linen") {
      layers.push({
        image: "repeating-linear-gradient(0deg, " + color + " 0, " + color + " 1px, transparent 1px, transparent " + size + "px)",
        size: "auto",
        position: "0 0",
        blend: texture.blendMode
      });
      layers.push({
        image: "repeating-linear-gradient(90deg, " + color + " 0, " + color + " 1px, transparent 1px, transparent " + size + "px)",
        size: "auto",
        position: "0 0",
        blend: texture.blendMode
      });
    } else if (texture.type === "wood") {
      layers.push({
        image: "repeating-linear-gradient(92deg, " + color + " 0, " + color + " 1px, transparent 1px, transparent " + size + "px)",
        size: "auto",
        position: "0 0",
        blend: texture.blendMode
      });
    }

    return layers;
  }

  function buildComposerVisual(style) {
    if (!style) {
      return {
        image: "none",
        size: "auto",
        position: "0 0",
        blend: "normal",
        boxShadow: "none"
      };
    }

    var layers = buildTextureLayers(style.texture);

    if (style.gradient) {
      layers.push({
        image: "linear-gradient(" + style.gradient.angle + "deg, " + style.gradient.from + ", " + style.gradient.to + ")",
        size: "auto",
        position: "0 0",
        blend: "normal"
      });
    }

    var shadows = [];
    if (style.shadow) {
      shadows.push(
        style.shadow.x + "px " +
        style.shadow.y + "px " +
        style.shadow.blur + "px " +
        style.shadow.spread + "px " +
        style.shadow.color
      );
    }
    if (style.highlight && style.highlight.size > 0) {
      shadows.push("inset 0 " + style.highlight.size + "px 0 0 " + style.highlight.color);
    }

    return {
      image: layers.length ? layers.map(function (layer) { return layer.image; }).join(", ") : "none",
      size: layers.length ? layers.map(function (layer) { return layer.size; }).join(", ") : "auto",
      position: layers.length ? layers.map(function (layer) { return layer.position; }).join(", ") : "0 0",
      blend: layers.length ? layers.map(function (layer) { return layer.blend; }).join(", ") : "normal",
      boxShadow: shadows.length ? shadows.join(", ") : "none"
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
      'html[' + THEME_ATTRIBUTE + '="on"] [' + COMPOSER_SURFACE_ATTRIBUTE + '="on"] {' +
      'background-color:var(--cgl-composer-bg)!important;' +
      'background-image:var(--cgl-composer-background-image)!important;' +
      'background-size:var(--cgl-composer-background-size)!important;' +
      'background-position:var(--cgl-composer-background-position)!important;' +
      'background-blend-mode:var(--cgl-composer-background-blend)!important;' +
      'background-clip:padding-box!important;' +
      'box-shadow:var(--cgl-composer-box-shadow)!important;' +
      'border-color:var(--cgl-border)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] #prompt-textarea {' +
      'color:var(--cgl-text)!important;caret-color:var(--cgl-accent)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] #prompt-textarea::placeholder {' +
      'color:var(--cgl-muted-text)!important;}' +
      'html[' + THEME_ATTRIBUTE + '="on"] pre, html[' + THEME_ATTRIBUTE + '="on"] code {' +
      'border-color:var(--cgl-border)!important;}';

    document.head.appendChild(style);
  }

  function findEditor() {
    return document.querySelector(
      '#prompt-textarea, textarea[data-id="root"], form textarea, form [contenteditable="true"]'
    );
  }

  function parseRadius(value) {
    var number = parseFloat(value);
    return Number.isFinite(number) ? number : 0;
  }

  function findComposerSurface() {
    var editor = findEditor();
    if (!editor) return null;

    var explicit = editor.closest(
      '[data-type="unified-composer"], [data-testid="composer"], [data-testid="composer-surface"]'
    );
    if (explicit) return explicit;

    var form = editor.closest("form");
    var editorRect = editor.getBoundingClientRect();
    var element = editor.parentElement;

    while (element && element !== document.body) {
      if (element instanceof HTMLElement) {
        var rect = element.getBoundingClientRect();
        var computed = getComputedStyle(element);
        var radius = Math.max(
          parseRadius(computed.borderTopLeftRadius),
          parseRadius(computed.borderTopRightRadius),
          parseRadius(computed.borderBottomLeftRadius),
          parseRadius(computed.borderBottomRightRadius)
        );

        if (
          radius >= 10 &&
          rect.width >= Math.max(220, editorRect.width) &&
          rect.height >= editorRect.height &&
          rect.height <= 320
        ) {
          return element;
        }
      }

      if (element === form) break;
      element = element.parentElement;
    }

    return form || editor.parentElement;
  }

  function clearComposerSurface() {
    document.querySelectorAll("[" + COMPOSER_SURFACE_ATTRIBUTE + "]").forEach(function (element) {
      element.removeAttribute(COMPOSER_SURFACE_ATTRIBUTE);
    });
  }

  function applyComposerSurface(composerStyle) {
    var current = composerStyle ? findComposerSurface() : null;

    document.querySelectorAll("[" + COMPOSER_SURFACE_ATTRIBUTE + "]").forEach(function (element) {
      if (element !== current) element.removeAttribute(COMPOSER_SURFACE_ATTRIBUTE);
    });

    if (current && current.getAttribute(COMPOSER_SURFACE_ATTRIBUTE) !== "on") {
      current.setAttribute(COMPOSER_SURFACE_ATTRIBUTE, "on");
    }
  }

  function clearTheme(root) {
    root.removeAttribute(THEME_ATTRIBUTE);
    clearComposerSurface();
    OWN_THEME_PROPERTIES.concat(CHATGPT_THEME_PROPERTIES).forEach(function (property) {
      root.style.removeProperty(property);
    });
  }

  function setRootVariable(root, property, value) {
    if (root.style.getPropertyValue(property) !== String(value)) {
      root.style.setProperty(property, value, "important");
    }
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
    if (root.getAttribute(THEME_ATTRIBUTE) !== "on") root.setAttribute(THEME_ATTRIBUTE, "on");

    var composerVisual = buildComposerVisual(theme.composerStyle);
    var variables = {
      "--cgl-page-bg": theme.pageBackground,
      "--cgl-surface-bg": theme.surfaceBackground,
      "--cgl-surface-alt-bg": theme.surfaceAltBackground,
      "--cgl-sidebar-bg": theme.sidebarBackground,
      "--cgl-composer-bg": theme.composerBackground,
      "--cgl-composer-background-image": composerVisual.image,
      "--cgl-composer-background-size": composerVisual.size,
      "--cgl-composer-background-position": composerVisual.position,
      "--cgl-composer-background-blend": composerVisual.blend,
      "--cgl-composer-box-shadow": composerVisual.boxShadow,
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
      setRootVariable(root, property, variables[property]);
    });

    applyComposerSurface(theme.composerStyle);
  }

  function findScrollContainer() {
    var turns = document.querySelectorAll(
      'article[data-testid^="conversation-turn"], [data-message-author-role]'
    );
    var lastTurn = turns.length ? turns[turns.length - 1] : null;
    var anchors = [
      lastTurn,
      findEditor(),
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

  function getEditorText(editor) {
    var target = editor || findEditor();
    if (!target) return "";
    if (typeof target.value === "string") return target.value.trim();
    return String(target.innerText || target.textContent || "").trim();
  }

  function setTextAreaValue(editor, text) {
    var prototype = editor instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && typeof descriptor.set === "function") descriptor.set.call(editor, text);
    else editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setContentEditableValue(editor, text) {
    editor.focus();
    var inserted = false;

    try {
      var selection = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      if (typeof document.execCommand === "function") {
        inserted = document.execCommand("insertText", false, text);
      }
    } catch (error) {
      inserted = false;
    }

    if (!inserted) editor.textContent = text;

    try {
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      }));
    } catch (error) {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function setEditorText(editor, text) {
    if (typeof editor.value === "string") setTextAreaValue(editor, text);
    else setContentEditableValue(editor, text);
    editor.focus();
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

  function showToast(text, isError) {
    if (!document.body) return;

    var toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }

    if (toast.textContent !== text) toast.textContent = text;
    var style = toast.style;
    setImportant(style, "position", "fixed");
    setImportant(style, "right", "16px");
    setImportant(style, "bottom", "168px");
    setImportant(style, "z-index", "2147483647");
    setImportant(style, "max-width", "calc(100vw - 32px)");
    setImportant(style, "padding", "9px 12px");
    setImportant(style, "border-radius", "10px");
    setImportant(style, "background", isError ? "#7f1d1d" : "#202024");
    setImportant(style, "color", "#ffffff");
    setImportant(style, "box-shadow", "0 4px 16px rgba(0,0,0,0.45)");
    setImportant(style, "font", "600 12px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
    setImportant(style, "opacity", "1");
    setImportant(style, "visibility", "visible");
    setImportant(style, "pointer-events", "none");

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      if (toast && toast.parentNode) toast.remove();
    }, 3600);
  }

  function normalizeButtonStyle(value, fallback) {
    var style = normalizeRecord(value);
    return {
      size: clampNumber(style.size, fallback.size, 32, 56),
      fontSize: clampNumber(style.fontSize, fallback.fontSize, 10, 24),
      background: normalizeColor(style.background, fallback.background),
      color: normalizeColor(style.color, fallback.color),
      borderColor: normalizeColor(style.borderColor, fallback.borderColor)
    };
  }

  function normalizeAction(raw) {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string" || !/^[a-z0-9_-]{1,48}$/i.test(raw.id)) return null;
    if (raw.enabled === false) return null;

    var type = typeof raw.type === "string" ? raw.type : "";
    if (["insertPrompt", "reload", "scrollToBottom"].indexOf(type) < 0) return null;

    var label = typeof raw.label === "string" ? raw.label.trim().slice(0, 8) : "";
    if (!label) return null;

    var action = {
      id: raw.id,
      label: label,
      title: typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim().slice(0, 100)
        : label,
      type: type,
      order: clampNumber(raw.order, 0, -1000, 1000),
      style: normalizeButtonStyle(raw.style, DEFAULT_LAYER_BUTTON_STYLE)
    };

    if (type === "insertPrompt") {
      if (typeof raw.text !== "string" || !raw.text.length) return null;
      action.text = raw.text.slice(0, 4000);
      action.mode = ["empty", "append", "replace"].indexOf(raw.mode) >= 0 ? raw.mode : "empty";
      action.separator = typeof raw.separator === "string" ? raw.separator.slice(0, 20) : "\n";
      action.confirmReplace = raw.confirmReplace !== false;
    }

    return action;
  }

  function normalizeActions(value) {
    if (!Array.isArray(value)) return [];

    var actions = [];
    var seen = {};

    value.forEach(function (raw) {
      var action = normalizeAction(raw);
      if (!action || seen[action.id]) return;
      seen[action.id] = true;
      actions.push(action);
    });

    actions.sort(function (left, right) {
      if (left.order !== right.order) return left.order - right.order;
      return left.id.localeCompare(right.id);
    });

    return actions.slice(0, 8);
  }

  function applyButtonStyle(button, right, visual) {
    var style = button.style;
    var size = visual.size;

    setImportant(style, "position", "fixed");
    setImportant(style, "top", "auto");
    setImportant(style, "left", "auto");
    setImportant(style, "right", right + "px");
    setImportant(style, "bottom", "120px");
    setImportant(style, "z-index", "2147483647");
    setImportant(style, "box-sizing", "border-box");
    setImportant(style, "display", "grid");
    setImportant(style, "place-items", "center");
    setImportant(style, "width", size + "px");
    setImportant(style, "min-width", size + "px");
    setImportant(style, "max-width", size + "px");
    setImportant(style, "height", size + "px");
    setImportant(style, "min-height", size + "px");
    setImportant(style, "max-height", size + "px");
    setImportant(style, "margin", "0");
    setImportant(style, "padding", "0");
    setImportant(style, "border", "1.5px solid " + visual.borderColor);
    setImportant(style, "border-radius", "999px");
    setImportant(style, "background", visual.background);
    setImportant(style, "color", visual.color);
    setImportant(style, "box-shadow", "0 4px 16px rgba(0,0,0,0.48)");
    setImportant(style, "font-family", "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
    setImportant(style, "font-size", visual.fontSize + "px");
    setImportant(style, "font-weight", "800");
    setImportant(style, "line-height", "1");
    setImportant(style, "text-align", "center");
    setImportant(style, "opacity", button.disabled ? "0.55" : "1");
    setImportant(style, "visibility", "visible");
    setImportant(style, "overflow", "hidden");
    setImportant(style, "pointer-events", "auto");
    setImportant(style, "transform", "none");
    setImportant(style, "appearance", "none");
    setImportant(style, "-webkit-appearance", "none");
    setImportant(style, "touch-action", "manipulation");
    setImportant(style, "-webkit-tap-highlight-color", "transparent");
  }

  function ensureActionButton(id, label, ariaLabel, right, visual, onClick) {
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

    if (button.textContent !== label) button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.setAttribute("title", ariaLabel);
    button.hidden = false;
    button.disabled = false;
    button.removeAttribute("aria-hidden");
    button.onclick = onClick;
    applyButtonStyle(button, right, visual);
    return button;
  }

  function ensureSharedButtons() {
    var reloadStyle = normalizeButtonStyle({ fontSize: 20 }, DEFAULT_BUTTON_STYLE);
    var scrollStyle = normalizeButtonStyle({ fontSize: 21 }, DEFAULT_BUTTON_STYLE);

    ensureActionButton(RELOAD_BUTTON_ID, "↻", "ページを再読み込みする", 64, reloadStyle, reloadPage);
    ensureActionButton(SCROLL_BUTTON_ID, "↓", "一番下までスクロールする", 16, scrollStyle, scrollToBottom);
  }

  function runInsertPromptAction(action) {
    var editor = findEditor();
    if (!editor) {
      showToast("入力欄が見つかりませんでした。", true);
      return;
    }

    var existing = getEditorText(editor);
    var nextText = action.text;

    if (action.mode === "empty" && existing) {
      showToast("入力中の文章があるため、挿入しませんでした。", true);
      return;
    }

    if (action.mode === "append" && existing) {
      nextText = existing + action.separator + action.text;
    }

    if (
      action.mode === "replace" &&
      existing &&
      action.confirmReplace &&
      !window.confirm("入力中の文章を置き換えますか？")
    ) {
      return;
    }

    setEditorText(editor, nextText);
    showToast("入力欄へ「" + action.label + "」をセットしました。", false);
  }

  function runLayerAction(action) {
    if (action.type === "insertPrompt") {
      runInsertPromptAction(action);
      return;
    }
    if (action.type === "reload") {
      reloadPage();
      return;
    }
    if (action.type === "scrollToBottom") {
      scrollToBottom();
      return;
    }
    showToast("未対応のアクションです。", true);
  }

  function removeStaleLayerButtons(activeIds) {
    document.querySelectorAll("[" + ACTION_ATTRIBUTE + "]").forEach(function (button) {
      var actionId = button.getAttribute(ACTION_ATTRIBUTE);
      if (!activeIds[actionId]) button.remove();
    });
  }

  function ensureLayerButtons(value) {
    var actions = normalizeActions(value);
    var activeIds = {};
    var right = 112;

    actions.forEach(function (action) {
      activeIds[action.id] = true;
      var buttonId = ACTION_BUTTON_PREFIX + action.id;
      var button = ensureActionButton(
        buttonId,
        action.label,
        action.title,
        right,
        action.style,
        function () { runLayerAction(action); }
      );
      if (button) button.setAttribute(ACTION_ATTRIBUTE, action.id);
      right += action.style.size + 8;
    });

    removeStaleLayerButtons(activeIds);
  }

  function setAttributeIfChanged(element, name, value) {
    if (value === null || value === undefined || value === "") {
      if (element.hasAttribute(name)) element.removeAttribute(name);
      return;
    }
    if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value));
  }

  function applyContext(context) {
    var root = document.documentElement;
    if (!root) return;

    setAttributeIfChanged(root, LAYER_ATTRIBUTE, context.layerName);
    setAttributeIfChanged(root, LAYERS_ATTRIBUTE, context.layerNames.join(" "));
    setAttributeIfChanged(root, VERSION_ATTRIBUTE, context.configVersion);
    setAttributeIfChanged(root, PROJECT_ATTRIBUTE, context.projectId);
    setAttributeIfChanged(root, CHAT_ATTRIBUTE, context.chatId);

    applyTheme(context.settings.theme);
    ensureSharedButtons();
    ensureLayerButtons(context.settings.actions);

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
    var cachedConfig = readCachedConfig();
    activeConfig = cachedConfig || DEFAULT_CONFIG;
    render();
    observeNavigation();

    try {
      activeConfig = await loadRemoteConfig();
      writeCachedConfig(activeConfig);
      render();
    } catch (error) {
      console.warn("[ChatGPT Layer] Remote config load failed.", error);
      if (!cachedConfig) {
        activeConfig = DEFAULT_CONFIG;
        render();
      }
    }
  }

  start();
})();
