// ==UserScript==
// @name         ChatGPT Layer Loader
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.5.3
// @description  Select a ChatGPT Layer and provide a shared scroll button.
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
  var BUTTON_ID = LAYER_ID + "-scroll-bottom";
  var CACHE_KEY = LAYER_ID + ":last-good-config:v4";
  var LAYER_ATTRIBUTE = "data-chatgpt-layer";
  var PROJECT_ATTRIBUTE = "data-chatgpt-project-id";
  var VERSION_ATTRIBUTE = "data-chatgpt-layer-config-version";

  var CONFIG_URLS = [
    "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.config.json",
    "https://cdn.jsdelivr.net/gh/takuyarisa-collab/chatgpt-layer@main/chatgpt-layer.config.json"
  ];

  var DEFAULT_CONFIG = {
    version: "builtin-0.5.3",
    base: {},
    projects: {},
    layers: { default: {} }
  };

  var activeConfig = DEFAULT_CONFIG;
  var renderScheduled = false;
  var lastContextKey = "";

  function normalizeRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function validateConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("設定ファイルの形式が不正です。");
    }

    var rawLayers = normalizeRecord(value.layers);
    var layers = {};

    Object.keys(rawLayers).forEach(function (layerName) {
      if (/^[a-z0-9_-]+$/i.test(layerName)) {
        layers[layerName] = normalizeRecord(rawLayers[layerName]);
      }
    });

    if (!layers.default) layers.default = {};

    var rawProjects = normalizeRecord(value.projects);
    var projects = {};

    Object.keys(rawProjects).forEach(function (projectId) {
      var layerName = rawProjects[projectId];
      if (
        /^g-p-[a-z0-9]+$/i.test(projectId) &&
        typeof layerName === "string" &&
        layers[layerName]
      ) {
        projects[projectId] = layerName;
      }
    });

    return {
      version: String(value.version || "unknown"),
      base: normalizeRecord(value.base),
      projects: projects,
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
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
          } else {
            reject(new Error("HTTP " + response.status));
          }
        },
        onerror: function () {
          reject(new Error("network error"));
        },
        ontimeout: function () {
          reject(new Error("timeout"));
        }
      });
    });
  }

  async function requestText(url) {
    var separator = url.indexOf("?") >= 0 ? "&" : "?";
    var target = url + separator + "t=" + Date.now();

    try {
      var response = await fetch(target, {
        cache: "no-store",
        credentials: "omit"
      });
      if (response.ok) return response.text();
    } catch (error) {
      // Try Userscript APIs next.
    }

    if (typeof GM_xmlhttpRequest === "function") {
      return requestWithLegacyGM(target);
    }

    if (globalThis.GM && typeof globalThis.GM.xmlHttpRequest === "function") {
      var gmResponse = await globalThis.GM.xmlHttpRequest({
        method: "GET",
        url: target,
        headers: { "Cache-Control": "no-cache" },
        timeout: 10000
      });
      if (gmResponse.status >= 200 && gmResponse.status < 300) {
        return gmResponse.responseText;
      }
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
    var match = path.match(
      /^\/g\/(g-p-[a-z0-9]{16,64})(?:-[^/]+)?(?:\/|$)/i
    );
    return match ? match[1] : null;
  }

  function resolveContext(config) {
    var projectId = getProjectId();
    var requestedLayer = projectId
      ? config.projects[projectId] || "default"
      : "default";
    var layerName = config.layers[requestedLayer]
      ? requestedLayer
      : "default";

    return {
      configVersion: config.version,
      projectId: projectId,
      layerName: layerName
    };
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
          if (
            overflowY === "auto" ||
            overflowY === "scroll" ||
            overflowY === "overlay"
          ) {
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

    if (nativeButton && typeof nativeButton.click === "function") {
      nativeButton.click();
    }

    var target = findScrollContainer();
    var isDocumentTarget =
      target === document.scrollingElement ||
      target === document.documentElement ||
      target === document.body;

    if (isDocumentTarget) {
      var bodyHeight = document.body ? document.body.scrollHeight : 0;
      var bottom = Math.max(document.documentElement.scrollHeight, bodyHeight);
      window.scrollTo(0, bottom);
    } else {
      target.scrollTop = target.scrollHeight;
    }
  }

  function scrollToBottom() {
    performScrollToBottom();
    requestAnimationFrame(performScrollToBottom);
    window.setTimeout(performScrollToBottom, 120);
  }

  function setImportant(style, property, value) {
    style.setProperty(property, value, "important");
  }

  function ensureScrollButton() {
    if (!document.body) return null;

    var button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "↓";
      button.setAttribute("aria-label", "一番下までスクロールする");
      button.setAttribute("title", "一番下までスクロールする");
      document.body.appendChild(button);
    } else if (button.parentElement !== document.body) {
      document.body.appendChild(button);
    }

    button.hidden = false;
    button.disabled = false;
    button.removeAttribute("aria-hidden");
    button.onclick = scrollToBottom;

    var style = button.style;
    setImportant(style, "position", "fixed");
    setImportant(style, "right", "16px");
    setImportant(style, "bottom", "120px");
    setImportant(style, "z-index", "2147483647");
    setImportant(style, "display", "grid");
    setImportant(style, "place-items", "center");
    setImportant(style, "width", "40px");
    setImportant(style, "min-width", "40px");
    setImportant(style, "height", "40px");
    setImportant(style, "min-height", "40px");
    setImportant(style, "margin", "0");
    setImportant(style, "padding", "0");
    setImportant(style, "border", "1.5px solid rgba(255,255,255,0.82)");
    setImportant(style, "border-radius", "999px");
    setImportant(style, "background", "#7c3aed");
    setImportant(style, "color", "#ffffff");
    setImportant(style, "box-shadow", "0 4px 16px rgba(0,0,0,0.48)");
    setImportant(style, "font-family", "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
    setImportant(style, "font-size", "21px");
    setImportant(style, "font-weight", "800");
    setImportant(style, "line-height", "1");
    setImportant(style, "opacity", "1");
    setImportant(style, "visibility", "visible");
    setImportant(style, "pointer-events", "auto");
    setImportant(style, "transform", "none");
    setImportant(style, "appearance", "none");
    setImportant(style, "-webkit-appearance", "none");
    setImportant(style, "touch-action", "manipulation");

    return button;
  }

  function applyContext(context) {
    var root = document.documentElement;
    if (!root) return;

    root.setAttribute(LAYER_ATTRIBUTE, context.layerName);
    root.setAttribute(VERSION_ATTRIBUTE, context.configVersion);

    if (context.projectId) {
      root.setAttribute(PROJECT_ATTRIBUTE, context.projectId);
    } else {
      root.removeAttribute(PROJECT_ATTRIBUTE);
    }

    ensureScrollButton();

    var contextKey =
      context.configVersion + ":" +
      (context.projectId || "none") + ":" +
      context.layerName;

    if (contextKey !== lastContextKey) {
      lastContextKey = contextKey;
      console.info("[ChatGPT Layer] Active layer", {
        projectId: context.projectId,
        layer: context.layerName,
        configVersion: context.configVersion
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