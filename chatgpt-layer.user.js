// ==UserScript==
// @name         ChatGPT Layer Loader
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.5.0
// @description  Select a ChatGPT Layer and provide shared actions for every project.
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
  const ACTIONS_ID = `${LAYER_ID}-actions`;
  const STYLE_ID = `${LAYER_ID}-style`;
  const STATUS_ID = `${LAYER_ID}-status`;
  const CACHE_KEY = `${LAYER_ID}:last-good-config:v3`;

  const LAYER_ATTRIBUTE = "data-chatgpt-layer";
  const PROJECT_ATTRIBUTE = "data-chatgpt-project-id";
  const VERSION_ATTRIBUTE = "data-chatgpt-layer-config-version";

  const CONFIG_URLS = [
    "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.config.json",
    "https://cdn.jsdelivr.net/gh/takuyarisa-collab/chatgpt-layer@main/chatgpt-layer.config.json",
  ];

  const DEFAULT_SCROLL_ACTION = {
    id: "scroll-bottom",
    type: "scrollToBottom",
    label: "↓",
    ariaLabel: "一番下までスクロールする",
  };

  const DEFAULT_CONFIG = {
    version: "builtin-0.5.0",
    base: {
      position: { right: 14, bottom: 112 },
      actions: [DEFAULT_SCROLL_ACTION],
    },
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

  function normalizeNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
  }

  function normalizePosition(value, fallback = {}) {
    const position = normalizeRecord(value);
    const normalized = {};

    if (Object.hasOwn(position, "right") || Object.hasOwn(fallback, "right")) {
      normalized.right = normalizeNumber(position.right, fallback.right ?? 14);
    }

    if (Object.hasOwn(position, "bottom") || Object.hasOwn(fallback, "bottom")) {
      normalized.bottom = normalizeNumber(position.bottom, fallback.bottom ?? 112);
    }

    return normalized;
  }

  function normalizeAction(value) {
    const action = normalizeRecord(value);
    if (!/^[a-z0-9_-]+$/i.test(String(action.id ?? ""))) return null;
    if (action.type !== "scrollToBottom") return null;

    return {
      id: String(action.id),
      type: action.type,
      label: String(action.label ?? "↓").slice(0, 24),
      ariaLabel: String(
        action.ariaLabel ?? action.label ?? "一番下までスクロールする",
      ).slice(0, 80),
    };
  }

  function normalizeActions(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeAction).filter(Boolean);
  }

  function normalizeLayer(value) {
    const layer = normalizeRecord(value);
    return {
      position: normalizePosition(layer.position),
      actions: normalizeActions(layer.actions),
    };
  }

  function validateConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("設定ファイルの形式が不正です。");
    }

    const rawBase = normalizeRecord(value.base);
    const base = {
      position: normalizePosition(rawBase.position, DEFAULT_CONFIG.base.position),
      actions: normalizeActions(rawBase.actions),
    };

    const rawLayers = normalizeRecord(value.layers);
    const layers = {};

    for (const [layerName, layerConfig] of Object.entries(rawLayers)) {
      if (/^[a-z0-9_-]+$/i.test(layerName)) {
        layers[layerName] = normalizeLayer(layerConfig);
      }
    }

    if (!layers.default) layers.default = normalizeLayer({});

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
      base,
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

  function mergeActions(baseActions, layerActions) {
    const actions = new Map();

    for (const action of [...baseActions, ...layerActions]) {
      actions.set(action.id, action);
    }

    return [...actions.values()];
  }

  function resolveContext(config = activeConfig) {
    const projectId = getProjectId();
    const requestedLayer = projectId
      ? config.projects[projectId] ?? "default"
      : "default";
    const layerName = config.layers[requestedLayer]
      ? requestedLayer
      : "default";
    const layer = config.layers[layerName];

    return {
      configVersion: config.version,
      projectId,
      layerName,
      position: {
        right: layer.position.right ?? config.base.position.right,
        bottom: layer.position.bottom ?? config.base.position.bottom,
      },
      actions: mergeActions(config.base.actions, layer.actions),
    };
  }

  function isScrollable(element) {
    if (!(element instanceof Element)) return false;
    if (element.clientHeight <= 0 || element.scrollHeight <= element.clientHeight + 8) {
      return false;
    }

    const overflowY = getComputedStyle(element).overflowY;
    return ["auto", "scroll", "overlay"].includes(overflowY);
  }

  function findScrollContainer() {
    const conversationTurns = document.querySelectorAll(
      'article[data-testid^="conversation-turn"], [data-message-author-role]',
    );
    const lastTurn = conversationTurns[conversationTurns.length - 1] ?? null;
    const anchors = [
      lastTurn,
      document.querySelector("main"),
      document.querySelector('[role="main"]'),
      document.querySelector("#prompt-textarea"),
    ];

    for (const anchor of anchors) {
      let element = anchor instanceof Element ? anchor : null;
      while (element && element !== document.body) {
        if (isScrollable(element)) return element;
        element = element.parentElement;
      }
    }

    return document.scrollingElement ?? document.documentElement;
  }

  function performScrollToBottom() {
    const target = findScrollContainer();
    const isDocumentTarget =
      target === document.scrollingElement ||
      target === document.documentElement ||
      target === document.body;

    if (isDocumentTarget) {
      const bottom = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      );
      window.scrollTo({ top: bottom, left: 0, behavior: "auto" });
      return;
    }

    target.scrollTo({ top: target.scrollHeight, left: 0, behavior: "auto" });
  }

  function scrollToBottom() {
    performScrollToBottom();
    window.requestAnimationFrame(performScrollToBottom);
    window.setTimeout(performScrollToBottom, 120);
  }

  function runAction(action) {
    if (action.type === "scrollToBottom") {
      scrollToBottom();
    }
  }

  function installStyle() {
    if (!document.head || document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ACTIONS_ID} {
        position: fixed;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      }

      #${ACTIONS_ID} button {
        min-width: 44px;
        height: 44px;
        padding: 0 14px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 999px;
        background: rgba(30, 30, 34, 0.88);
        color: rgba(255, 255, 255, 0.94);
        box-shadow: 0 5px 18px rgba(0, 0, 0, 0.28);
        font: 700 20px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-backdrop-filter: blur(14px);
        backdrop-filter: blur(14px);
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
      }

      #${ACTIONS_ID} button:active {
        transform: scale(0.94);
      }
    `;
    document.head.appendChild(style);
  }

  function renderActions(context) {
    if (!document.body) return;
    installStyle();

    let bar = document.getElementById(ACTIONS_ID);

    if (!context.actions.length) {
      bar?.remove();
      return;
    }

    if (!bar) {
      bar = document.createElement("div");
      bar.id = ACTIONS_ID;
      document.body.appendChild(bar);
    }

    bar.style.right = `${context.position.right}px`;
    bar.style.bottom =
      `calc(env(safe-area-inset-bottom, 0px) + ${context.position.bottom}px)`;
    bar.dataset.configVersion = context.configVersion;
    bar.dataset.layer = context.layerName;

    const expectedIds = new Set();

    for (const action of context.actions) {
      const buttonId = `${LAYER_ID}-action-${action.id}`;
      expectedIds.add(buttonId);

      let button = document.getElementById(buttonId);
      if (!button) {
        button = document.createElement("button");
        button.id = buttonId;
        button.type = "button";
        bar.appendChild(button);
      }

      if (button.textContent !== action.label) button.textContent = action.label;
      button.setAttribute("aria-label", action.ariaLabel);
      button.dataset.actionType = action.type;
      button.onclick = () => runAction(action);
    }

    for (const child of [...bar.children]) {
      if (!expectedIds.has(child.id)) child.remove();
    }
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

    renderActions(context);

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
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 166px)",
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
      showStatus("設定取得失敗・内蔵の共通ボタンで動作中");
    }
  }

  start();
})();
