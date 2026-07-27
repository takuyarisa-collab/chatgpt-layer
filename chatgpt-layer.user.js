// ==UserScript==
// @name         ChatGPT Layer Loader
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.3.0
// @description  Load ChatGPT Layer settings and theme from GitHub without executing remote code.
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
  const STYLE_ID = `${LAYER_ID}-style`;
  const BAR_ID = `${LAYER_ID}-actions`;
  const STATUS_ID = `${LAYER_ID}-status`;
  const CACHE_KEY = `${LAYER_ID}:last-good-config`;
  const THEME_ATTRIBUTE = "data-chatgpt-layer-theme";

  const CONFIG_URLS = [
    "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.config.json",
    "https://cdn.jsdelivr.net/gh/takuyarisa-collab/chatgpt-layer@main/chatgpt-layer.config.json",
  ];

  const DEFAULT_THEME = {
    enabled: true,
    pageBackground: "#100d16",
    surfaceBackground: "#17121f",
    surfaceAltBackground: "#20192b",
    sidebarBackground: "#0c0a11",
    composerBackground: "#1c1626",
    textColor: "#f5f1fa",
    mutedTextColor: "#bdb5ca",
    borderColor: "rgba(168, 139, 250, 0.18)",
    accentColor: "#9f82ff",
  };

  const DEFAULT_CONFIG = {
    version: "builtin-0.3.0",
    position: { right: 14, bottom: 94 },
    theme: DEFAULT_THEME,
    actions: [
      {
        id: "shiori",
        type: "prompt",
        label: "しおり",
        ariaLabel: "しおりを送信",
        text: "しおり",
        autoSend: true,
        style: {
          border: "1px solid rgba(224, 216, 255, 0.72)",
          background:
            "linear-gradient(135deg, rgba(139, 110, 255, 0.96), rgba(101, 76, 214, 0.96))",
          color: "#ffffff",
          boxShadow: "0 5px 18px rgba(92, 63, 196, 0.38)",
        },
      },
    ],
  };

  const SELECTORS = {
    editor: [
      "#prompt-textarea",
      'textarea[data-id="root"]',
      "form textarea",
      'form [contenteditable="true"]',
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="メッセージを送信する"]',
      'button[aria-label="送信"]',
    ],
    stopButton: [
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="生成を停止する"]',
    ],
  };

  const OWN_THEME_PROPERTIES = [
    "--cgl-page-bg",
    "--cgl-surface-bg",
    "--cgl-surface-alt-bg",
    "--cgl-sidebar-bg",
    "--cgl-composer-bg",
    "--cgl-text",
    "--cgl-muted-text",
    "--cgl-border",
    "--cgl-accent",
  ];

  const CHATGPT_THEME_PROPERTIES = [
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
    "--border-medium",
  ];

  let activeConfig = DEFAULT_CONFIG;
  let scheduled = false;

  const sleep = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function findEditor() {
    return queryFirst(SELECTORS.editor);
  }

  function findComposerForm(editor) {
    return editor?.closest("form") ?? document.querySelector("form");
  }

  function findSendButton(editor) {
    const form = findComposerForm(editor);
    return (
      queryFirst(SELECTORS.sendButton, form ?? document) ??
      queryFirst(SELECTORS.sendButton)
    );
  }

  function isGenerating() {
    return Boolean(queryFirst(SELECTORS.stopButton));
  }

  function getEditorText(editor) {
    if (!editor) return "";
    if (
      editor instanceof HTMLTextAreaElement ||
      editor instanceof HTMLInputElement
    ) {
      return editor.value.trim();
    }
    return (editor.innerText || editor.textContent || "").trim();
  }

  function dispatchInput(editor, text) {
    try {
      editor.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: text,
        }),
      );
    } catch {
      editor.dispatchEvent(
        new Event("input", { bubbles: true, composed: true }),
      );
    }
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setEditorValue(editor, text) {
    if (
      editor instanceof HTMLTextAreaElement ||
      editor instanceof HTMLInputElement
    ) {
      const prototype = Object.getPrototypeOf(editor);
      const valueSetter = Object.getOwnPropertyDescriptor(
        prototype,
        "value",
      )?.set;

      if (valueSetter) valueSetter.call(editor, text);
      else editor.value = text;

      dispatchInput(editor, text);
      editor.focus();
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const inserted = document.execCommand?.("insertText", false, text);
    if (!inserted) editor.replaceChildren(document.createTextNode(text));
    dispatchInput(editor, text);
  }

  async function waitForSendButton(editor, timeoutMs = 2500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const button = findSendButton(editor);
      const disabled =
        !button ||
        button.disabled ||
        button.getAttribute("aria-disabled") === "true";
      if (!disabled) return button;
      await sleep(100);
    }
    return null;
  }

  function showMessage(message) {
    window.alert(`[ChatGPT Layer]\n${message}`);
  }

  async function sendPrompt(action) {
    if (isGenerating()) {
      showMessage("回答の生成が終わってから押してね。");
      return;
    }

    const editor = findEditor();
    if (!editor) {
      showMessage(
        "入力欄が見つかりませんでした。画面を再読み込みしてみてください。",
      );
      return;
    }

    const text = String(action.text ?? "");
    const currentText = getEditorText(editor);
    if (
      currentText &&
      currentText !== text &&
      !window.confirm(`入力中の文章を消して「${text}」を送信しますか？`)
    ) {
      return;
    }

    setEditorValue(editor, text);
    if (action.autoSend === false) return;

    const sendButton = await waitForSendButton(editor);
    if (sendButton) {
      sendButton.click();
      return;
    }

    const form = findComposerForm(editor);
    if (form?.requestSubmit) {
      form.requestSubmit();
      return;
    }

    showMessage(`「${text}」は入力しましたが、自動送信できませんでした。`);
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
          } else reject(new Error(`HTTP ${response.status}`));
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
      // Try userscript APIs next.
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

  function normalizeNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
  }

  function normalizeColor(value, fallback) {
    if (typeof value !== "string") return fallback;
    const candidate = value.trim();
    if (!candidate) return fallback;
    if (!globalThis.CSS?.supports?.("color", candidate)) return fallback;
    return candidate;
  }

  function normalizeTheme(value) {
    const theme = value && typeof value === "object" ? value : {};
    return {
      enabled: theme.enabled !== false,
      pageBackground: normalizeColor(
        theme.pageBackground,
        DEFAULT_THEME.pageBackground,
      ),
      surfaceBackground: normalizeColor(
        theme.surfaceBackground,
        DEFAULT_THEME.surfaceBackground,
      ),
      surfaceAltBackground: normalizeColor(
        theme.surfaceAltBackground,
        DEFAULT_THEME.surfaceAltBackground,
      ),
      sidebarBackground: normalizeColor(
        theme.sidebarBackground,
        DEFAULT_THEME.sidebarBackground,
      ),
      composerBackground: normalizeColor(
        theme.composerBackground,
        DEFAULT_THEME.composerBackground,
      ),
      textColor: normalizeColor(theme.textColor, DEFAULT_THEME.textColor),
      mutedTextColor: normalizeColor(
        theme.mutedTextColor,
        DEFAULT_THEME.mutedTextColor,
      ),
      borderColor: normalizeColor(
        theme.borderColor,
        DEFAULT_THEME.borderColor,
      ),
      accentColor: normalizeColor(
        theme.accentColor,
        DEFAULT_THEME.accentColor,
      ),
    };
  }

  function validateConfig(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.actions)) {
      throw new Error("設定ファイルの形式が不正です。");
    }

    const actions = value.actions.filter(
      (action) =>
        action &&
        typeof action.id === "string" &&
        typeof action.label === "string" &&
        action.type === "prompt" &&
        typeof action.text === "string",
    );

    if (!actions.length) throw new Error("利用可能なアクションがありません。");

    return {
      version: String(value.version ?? "unknown"),
      position: {
        right: normalizeNumber(value.position?.right, 14),
        bottom: normalizeNumber(value.position?.bottom, 94),
      },
      theme: normalizeTheme(value.theme),
      actions,
    };
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

  function installStyle() {
    if (!document.head || document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html[${THEME_ATTRIBUTE}="on"],
      html[${THEME_ATTRIBUTE}="on"] body,
      html[${THEME_ATTRIBUTE}="on"] #__next {
        background-color: var(--cgl-page-bg) !important;
        color: var(--cgl-text) !important;
      }

      html[${THEME_ATTRIBUTE}="on"] main,
      html[${THEME_ATTRIBUTE}="on"] [role="main"],
      html[${THEME_ATTRIBUTE}="on"] [class*="bg-token-main-surface-primary"] {
        background-color: var(--cgl-page-bg) !important;
      }

      html[${THEME_ATTRIBUTE}="on"] [class*="bg-token-main-surface-secondary"] {
        background-color: var(--cgl-surface-bg) !important;
      }

      html[${THEME_ATTRIBUTE}="on"] [class*="bg-token-main-surface-tertiary"] {
        background-color: var(--cgl-surface-alt-bg) !important;
      }

      html[${THEME_ATTRIBUTE}="on"] nav,
      html[${THEME_ATTRIBUTE}="on"] aside,
      html[${THEME_ATTRIBUTE}="on"] [class*="bg-token-sidebar-surface-primary"] {
        background-color: var(--cgl-sidebar-bg) !important;
      }

      html[${THEME_ATTRIBUTE}="on"] [class*="bg-token-sidebar-surface-secondary"] {
        background-color: var(--cgl-surface-bg) !important;
      }

      html[${THEME_ATTRIBUTE}="on"] [class*="bg-token-composer-surface-primary"],
      html[${THEME_ATTRIBUTE}="on"] form:has(#prompt-textarea),
      html[${THEME_ATTRIBUTE}="on"] div:has(> #prompt-textarea),
      html[${THEME_ATTRIBUTE}="on"] div:has(> div > #prompt-textarea) {
        background-color: var(--cgl-composer-bg) !important;
        border-color: var(--cgl-border) !important;
      }

      html[${THEME_ATTRIBUTE}="on"] #prompt-textarea {
        color: var(--cgl-text) !important;
        caret-color: var(--cgl-accent) !important;
      }

      html[${THEME_ATTRIBUTE}="on"] #prompt-textarea::placeholder {
        color: var(--cgl-muted-text) !important;
      }

      html[${THEME_ATTRIBUTE}="on"] pre,
      html[${THEME_ATTRIBUTE}="on"] code {
        border-color: var(--cgl-border) !important;
      }

      #${BAR_ID} {
        position: fixed;
        z-index: 2147483647;
        display: flex;
        gap: 8px;
        align-items: center;
      }

      #${BAR_ID} button {
        appearance: none;
        border-radius: 999px;
        padding: 10px 15px;
        font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-backdrop-filter: blur(14px);
        backdrop-filter: blur(14px);
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
      }

      #${BAR_ID} button:active { transform: scale(0.96); }

      #${BAR_ID} button[disabled] {
        opacity: 0.45;
        pointer-events: none;
      }

      #${STATUS_ID} {
        position: fixed;
        right: 14px;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 146px);
        z-index: 2147483647;
        border: 1px solid rgba(255, 211, 145, 0.55);
        border-radius: 999px;
        padding: 7px 10px;
        background: rgba(79, 60, 25, 0.92);
        color: #fff2d5;
        font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
    `;
    document.head.appendChild(style);
  }

  function clearTheme(root) {
    root.removeAttribute(THEME_ATTRIBUTE);
    for (const property of [...OWN_THEME_PROPERTIES, ...CHATGPT_THEME_PROPERTIES]) {
      root.style.removeProperty(property);
    }
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (!root) return;

    if (!theme?.enabled) {
      clearTheme(root);
      return;
    }

    root.setAttribute(THEME_ATTRIBUTE, "on");
    root.style.setProperty("--cgl-page-bg", theme.pageBackground, "important");
    root.style.setProperty(
      "--cgl-surface-bg",
      theme.surfaceBackground,
      "important",
    );
    root.style.setProperty(
      "--cgl-surface-alt-bg",
      theme.surfaceAltBackground,
      "important",
    );
    root.style.setProperty(
      "--cgl-sidebar-bg",
      theme.sidebarBackground,
      "important",
    );
    root.style.setProperty(
      "--cgl-composer-bg",
      theme.composerBackground,
      "important",
    );
    root.style.setProperty("--cgl-text", theme.textColor, "important");
    root.style.setProperty(
      "--cgl-muted-text",
      theme.mutedTextColor,
      "important",
    );
    root.style.setProperty("--cgl-border", theme.borderColor, "important");
    root.style.setProperty("--cgl-accent", theme.accentColor, "important");

    const tokenValues = {
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
      "--border-medium": theme.borderColor,
    };

    for (const [property, value] of Object.entries(tokenValues)) {
      root.style.setProperty(property, value, "important");
    }
  }

  function applyActionStyle(button, action) {
    const style = action.style ?? {};
    button.style.border =
      style.border ?? "1px solid rgba(255,255,255,0.2)";
    button.style.background = style.background ?? "rgba(29,29,34,0.9)";
    button.style.color = style.color ?? "#ffffff";
    button.style.boxShadow =
      style.boxShadow ?? "0 5px 18px rgba(0,0,0,0.25)";
  }

  function render(config = activeConfig) {
    if (!document.body) return;
    installStyle();
    applyTheme(config.theme);

    let bar = document.getElementById(BAR_ID);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = BAR_ID;
      document.body.appendChild(bar);
    }

    bar.style.right = `${config.position.right}px`;
    bar.style.bottom =
      `calc(env(safe-area-inset-bottom, 0px) + ${config.position.bottom}px)`;
    bar.dataset.configVersion = config.version;

    const expectedIds = new Set();
    for (const action of config.actions) {
      const buttonId = `${LAYER_ID}-action-${action.id}`;
      expectedIds.add(buttonId);

      let button = document.getElementById(buttonId);
      if (!button) {
        button = document.createElement("button");
        button.id = buttonId;
        button.type = "button";
        bar.appendChild(button);
      }

      button.textContent = action.label;
      button.setAttribute("aria-label", action.ariaLabel || action.label);
      button.onclick = () => sendPrompt(action);
      button.disabled = isGenerating();
      applyActionStyle(button, action);
    }

    for (const child of [...bar.children]) {
      if (!expectedIds.has(child.id)) child.remove();
    }
  }

  function showStatus(message) {
    if (!document.body) return;
    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement("div");
      status.id = STATUS_ID;
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

  async function start() {
    activeConfig = readCachedConfig() ?? DEFAULT_CONFIG;
    render(activeConfig);

    try {
      activeConfig = await loadRemoteConfig();
      writeCachedConfig(activeConfig);
      render(activeConfig);
    } catch (error) {
      console.warn("[ChatGPT Layer] Remote config load failed.", error);
      showStatus("設定取得失敗・内蔵版で動作中");
    }

    new MutationObserver(scheduleRender).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  start();
})();