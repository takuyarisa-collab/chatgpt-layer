// ==UserScript==
// @name         ChatGPT Layer Loader
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.5.1
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
  const HOST_ID = `${LAYER_ID}-host`;
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
    version: "builtin-0.5.1",
    base: {
      position: { right: 14, bottom: 112 },
      actions: [DEFAULT_SCROLL_ACTION],
    },
    projects: {},
    layers: { default: {} },
  };

  let activeConfig = DEFAULT_CONFIG;
  let renderScheduled = false;
  let lastContextKey = "";

  const hasOwn = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);

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

    if (hasOwn(position, "right") || hasOwn(fallback, "right")) {
      normalized.right = normalizeNumber(position.right, fallback.right ?? 14);
    }

    if (hasOwn(position, "bottom") || hasOwn(fallback, "bottom")) {
      normalized.bottom = normalizeNumber(position.bottom, fallback.bottom ?? 112);
    }

    return normalized;
  }

  function normalizeAction(value) {
    const action = normalizeRecord(value);
    const id = String(action.id ?? "");

    if (!/^[a-z0-9_-]+$/i.test(id)) return null;
    if (action.type !== "scrollToBottom") return null;

    return {
      id,
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

    if (!base.actions.length) base.actions = [DEFAULT_SCROLL_ACTION];

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
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timeout")),
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

  async function loadRemoteConfig() {
    let lastError = null;

    for (const url of CONFIG_URLS) {
      try {
        return validateConfig(JSON.parse(await requestText(url)));
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
    const layer = config.layers[layerName] ?? normalizeLayer({});

    return {
      configVersion: config.version,
      projectId,
      layerName,
      position: {
        right: layer.position.right ?? config.base.position.right ?? 14,
        bottom: layer.position.bottom ?? config.base.position.bottom ?? 112,
      },
      actions: mergeActions(config.base.actions, layer.actions),
    };
  }

  function isScrollable(element) {
    if (!(element instanceof Element)) return false;
    if (element.clientHeight <= 0) return false;
    if (element.scrollHeight <= element.clientHeight + 8) return false;

    const overflowY = getComputedStyle(element).overflowY;
    return ["auto", "scroll", "overlay"].includes(overflowY);
  }

  function findScrollContainer() {
    const turns = document.querySelectorAll(
      'article[data-testid^="conversation-turn"], [data-message-author-role]',
    );
    const lastTurn = turns[turns.length - 1] ?? null;
    const anchors = [
      lastTurn,
      document.querySelector("#prompt-textarea"),
      document.querySelector("main"),
      document.querySelector('[role="main"]'),
    ];

    for (const anchor of anchors) {
      let element = anchor instanceof Element ? anchor : null;
      while (element && element !== document.documentElement) {
        if (isScrollable(element)) return element;
        element = element.parentElement;
      }
    }

    return document.scrollingElement ?? document.documentElement;
  }

  function performScrollToBottom() {
    const nativeButton = document.querySelector(
      'button[data-testid="scroll-to-bottom-button"], button[aria-label="Scroll to bottom"], button[aria-label="一番下までスクロール"]',
    );
    if (nativeButton instanceof HTMLButtonElement) nativeButton.click();

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
      window.scrollTo(0, bottom);
      return;
    }

    target.scrollTop = target.scrollHeight;
  }

  function scrollToBottom() {
    performScrollToBottom();
    requestAnimationFrame(performScrollToBottom);
    window.setTimeout(performScrollToBottom, 120);
  }

  function runAction(action) {
    if (action.type === "scrollToBottom") scrollToBottom();
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);

    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("role", "group");
      host.setAttribute("aria-label", "ChatGPT Layer actions");
      document.documentElement.appendChild(host);
    }

    Object.assign(host.style, {
      position: "fixed",
      zIndex: "2147483647",
      display: "block",
      width: "auto",
      height: "auto",
      margin: "0",
      padding: "0",
      border: "0",
      opacity: "1",
      visibility: "visible",
      pointerEvents: "none",
      transform: "translateZ(0)",
      isolation: "isolate",
    });

    if (!host.shadowRoot) {
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          #actions {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
            pointer-events: none;
          }
          button {
            all: initial;
            box-sizing: border-box;
            display: grid;
            place-items: center;
            min-width: 46px;
            width: 46px;
            height: 46px;
            padding: 0;
            border: 1px solid rgba(255, 255, 255, 0.32);
            border-radius: 999px;
            background: rgba(30, 30, 34, 0.94);
            color: #ffffff;
            box-shadow: 0 6px 22px rgba(0, 0, 0, 0.38);
            font: 700 23px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            -webkit-backdrop-filter: blur(14px);
            backdrop-filter: blur(14px);
            cursor: pointer;
            touch-action: manipulation;
            user-select: none;
            -webkit-user-select: none;
            pointer-events: auto;
          }
          button:active { transform: scale(0.92); }
        </style>
        <div id="actions"></div>
      `;
    }

    return host;
  }

  function renderActions(context) {
    if (!document.documentElement) return;

    const host = ensureHost();
    host.style.right = `${context.position.right}px`;
    host.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${context.position.bottom}px)`;
    host.dataset.configVersion = context.configVersion;
    host.dataset.layer = context.layerName;

    const container = host.shadowRoot?.getElementById("actions");
    if (!container) return;

    const expectedIds = new Set();

    for (const action of context.actions) {
      const buttonId = `action-${action.id}`;
      expectedIds.add(buttonId);

      let button = container.querySelector(`#${CSS.escape(buttonId)}`);
      if (!button) {
        button = document.createElement("button");
        button.id = buttonId;
        button.type = "button";
        container.appendChild(button);
      }

      button.textContent = action.label;
      button.setAttribute("aria-label", action.ariaLabel);
      button.setAttribute("title", action.ariaLabel);
      button.onclick = () => runAction(action);
    }

    for (const child of [...container.children]) {
      if (!expectedIds.has(child.id)) child.remove();
    }

    host.style.display = context.actions.length ? "block" : "none";
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
        actions: context.actions.map((action) => action.id),
      });
    }
  }

  function render() {
    applyContext(resolveContext());
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
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
      activeConfig = DEFAULT_CONFIG;
      render();
    }
  }

  start();
})();
