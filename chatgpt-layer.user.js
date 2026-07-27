// ==UserScript==
// @name         ChatGPT Layer Loader
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.2.1
// @description  Load ChatGPT Layer settings from GitHub without executing remote code.
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

  const CONFIG_URLS = [
    "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.config.json",
    "https://cdn.jsdelivr.net/gh/takuyarisa-collab/chatgpt-layer@main/chatgpt-layer.config.json",
  ];

  const DEFAULT_CONFIG = {
    version: "builtin-0.2.1",
    position: { right: 14, bottom: 94 },
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
        right: Number(value.position?.right ?? 14),
        bottom: Number(value.position?.bottom ?? 94),
      },
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
