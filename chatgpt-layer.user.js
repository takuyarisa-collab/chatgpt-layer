// ==UserScript==
// @name         ChatGPT Layer Loader
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.4.0
// @description  Select a ChatGPT Layer from the current project URL.
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

(() => {
  "use strict";

  const LAYER_ID = "chatgpt-layer";
  const STATUS_ID = `${LAYER_ID}-status`;
  const CACHE_KEY = `${LAYER_ID}:last-good-config:v2`;

  const LAYER_ATTRIBUTE = "data-chatgpt-layer";
  const PROJECT_ATTRIBUTE = "data-chatgpt-project-id";
  const VERSION_ATTRIBUTE = "data-chatgpt-layer-config-version";

  const CONFIG_URLS = [
    "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.config.json",
    "https://cdn.jsdelivr.net/gh/takuyarisa-collab/chatgpt-layer@main/chatgpt-layer.config.json",
  ];

  const DEFAULT_CONFIG = {
    version: "builtin-0.4.0",
    base: {},
    projects: {},
    layers: {
      default: {},
    },
  };

  let activeConfig = DEFAULT_CONFIG;
  let scheduled = false;
  let lastContextKey = "";

  function requestWithLegacyGM(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: { "Cache-Control": "no-cache" },
        timeout: 10000,
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
          } else {
            reject(new Error(`HTTP ${response.status}`));
          }
        },
        onerror() {
          reject(new Error("network error"));
        },
        ontimeout() {
          reject(new Error("timeout"));
        },
      });
    });
  }

  async function requestText(url) {
    const target = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;

    try {
      const response = await fetch(target, {
        cache: "no-store",
        credentials: "omit",
      });
      if (response.ok) return response.text();
    } catch {
      // Try Userscript APIs next.
    }

    if (typeof GM_xmlhttpRequest === "function") {
      return requestWithLegacyGM(target);
    }

    if (globalThis.GM?.xmlHttpRequest) {
      const response = await globalThis.GM.xmlHttpRequest({
        method: "GET",
        url: target,
        headers: { "Cache-Control": "no-cache" },
        timeout: 10000,
      });

      if (response.status >= 200 && response.status < 300) {
        return response.responseText;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    throw new Error("利用できる通信手段がありません。");
  }

  function normalizeRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function validateConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("設定ファイルの形式が不正です。");
    }

    const rawLayers = normalizeRecord(value.layers);
    const layers = {};

    for (const [layerName, layerConfig] of Object.entries(rawLayers)) {
      if (/^[a-z0-9_-]+$/i.test(layerName)) {
        layers[layerName] = normalizeRecord(layerConfig);
      }
    }

    if (!layers.default) layers.default = {};

    const rawProjects = normalizeRecord(value.projects);
    const projects = {};

    for (const [projectId, layerName] of Object.entries(rawProjects)) {
      if (
        /^g-p-[a-z0-9]+$/i.test(projectId) &&
        typeof layerName === "string" &&
        layers[layerName]
      ) {
        projects[projectId] = layerName;
      }
    }

    return {
      version: String(value.version ?? "unknown"),
      base: normalizeRecord(value.base),
      projects,
      layers,
    };
  }

  async function loadRemoteConfig() {
    let lastError = null;

    for (const url of CONFIG_URLS) {
      try {
        const text = await requestText(url);
        return validateConfig(JSON.parse(text));
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("設定を取得できませんでした。");
  }

  function readCachedConfig() {
    try {
      const text = localStorage.getItem(CACHE_KEY);
      return text ? validateConfig(JSON.parse(text)) : null;
    } catch {
      return null;
    }
  }

  function writeCachedConfig(config) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(config));
    } catch {
      // Continue without a cache.
    }
  }

  function getProjectId(pathname = location.pathname) {
    const match = pathname.match(
      /^\/g\/(g-p-[a-z0-9]{16,64})(?:-[^/]+)?(?:\/|$)/i,
    );
    return match?.[1] ?? null;
  }

  function resolveContext(config = activeConfig) {
    const projectId = getProjectId();
    const requestedLayer = projectId
      ? config.projects[projectId] ?? "default"
      : "default";
    const layerName = config.layers[requestedLayer]
      ? requestedLayer
      : "default";

    return {
      configVersion: config.version,
      projectId,
      layerName,
      base: config.base,
      layer: config.layers[layerName],
    };
  }

  function applyContext(context) {
    const root = document.documentElement;
    if (!root) return;

    root.setAttribute(LAYER_ATTRIBUTE, context.layerName);
    root.setAttribute(VERSION_ATTRIBUTE, context.configVersion);

    if (context.projectId) {
      root.setAttribute(PROJECT_ATTRIBUTE, context.projectId);
    } else {
      root.removeAttribute(PROJECT_ATTRIBUTE);
    }

    const contextKey = `${context.configVersion}:${context.projectId ?? "none"}:${context.layerName}`;
    if (contextKey !== lastContextKey) {
      lastContextKey = contextKey;
      console.info("[ChatGPT Layer] Active layer", {
        projectId: context.projectId,
        layer: context.layerName,
        configVersion: context.configVersion,
      });
    }
  }

  function render() {
    applyContext(resolveContext());
  }

  function showStatus(message) {
    if (!document.body) return;

    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement("div");
      status.id = STATUS_ID;
      Object.assign(status.style, {
        position: "fixed",
        right: "14px",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 94px)",
        zIndex: "2147483647",
        border: "1px solid rgba(255, 211, 145, 0.55)",
        borderRadius: "999px",
        padding: "7px 10px",
        background: "rgba(79, 60, 25, 0.92)",
        color: "#fff2d5",
        font: '600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      });
      document.body.appendChild(status);
    }

    status.textContent = message;
    window.setTimeout(() => status.remove(), 6000);
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;

    window.requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }

  function observeNavigation() {
    for (const methodName of ["pushState", "replaceState"]) {
      const original = history[methodName];
      if (typeof original !== "function") continue;

      history[methodName] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        scheduleRender();
        return result;
      };
    }

    window.addEventListener("popstate", scheduleRender);
    window.addEventListener("hashchange", scheduleRender);

    new MutationObserver(scheduleRender).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  async function start() {
    activeConfig = readCachedConfig() ?? DEFAULT_CONFIG;
    render();
    observeNavigation();

    try {
      activeConfig = await loadRemoteConfig();
      writeCachedConfig(activeConfig);
      render();
    } catch (error) {
      console.warn("[ChatGPT Layer] Remote config load failed.", error);
      showStatus("設定取得失敗・空の内蔵レイヤーで動作中");
    }
  }

  start();
})();
