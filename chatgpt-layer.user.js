// ==UserScript==
// @name         ChatGPT Layer
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.1.3
// @description  Add personal shortcut actions to ChatGPT Web.
// @author       TaC & Shion
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.meta.js
// @downloadURL  https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.user.js
// ==/UserScript==

(() => {
  "use strict";

  const LAYER_ID = "chatgpt-layer";
  const BUTTON_ID = `${LAYER_ID}-shiori-button`;
  const STYLE_ID = `${LAYER_ID}-style`;
  const SHIORI_TEXT = "しおり";

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

      if (valueSetter) {
        valueSetter.call(editor, text);
      } else {
        editor.value = text;
      }

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
    if (!inserted) {
      editor.replaceChildren(document.createTextNode(text));
    }

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

  async function sendText(text) {
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

    const currentText = getEditorText(editor);
    if (
      currentText &&
      currentText !== text &&
      !window.confirm(`入力中の文章を消して「${text}」を送信しますか？`)
    ) {
      return;
    }

    setEditorValue(editor, text);

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

  function installStyle() {
    if (!document.head || document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        right: 14px;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 94px);
        z-index: 2147483647;
        appearance: none;
        border: 1px solid rgba(224, 216, 255, 0.72);
        border-radius: 999px;
        padding: 10px 15px;
        background: linear-gradient(135deg, rgba(139, 110, 255, 0.96), rgba(101, 76, 214, 0.96));
        color: #fff;
        font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 5px 18px rgba(92, 63, 196, 0.38);
        -webkit-backdrop-filter: blur(14px);
        backdrop-filter: blur(14px);
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
      }

      #${BUTTON_ID}:active {
        transform: scale(0.96);
      }

      #${BUTTON_ID}[disabled] {
        opacity: 0.45;
        pointer-events: none;
      }
    `;

    document.head.appendChild(style);
  }

  function installButton() {
    if (!document.body) return;

    installStyle();

    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "しおり";
      button.setAttribute("aria-label", "しおりを送信");
      button.addEventListener("click", () => sendText(SHIORI_TEXT));
      document.body.appendChild(button);
    }

    button.disabled = isGenerating();
  }

  let scheduled = false;
  function scheduleInstall() {
    if (scheduled) return;
    scheduled = true;

    window.requestAnimationFrame(() => {
      scheduled = false;
      installButton();
    });
  }

  installButton();

  new MutationObserver(scheduleInstall).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
