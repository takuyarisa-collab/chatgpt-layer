// ==UserScript==
// @name         ChatGPT Layer Product Dev
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer-product
// @version      0.2.0-dev1
// @description  Gear-first product foundation with scoped page and Composer customization.
// @author       TaC & Shion
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @require      https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/releases/0.2.0-dev1/payload-01.js
// @require      https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/releases/0.2.0-dev1/payload-02.js
// @require      https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/releases/0.2.0-dev1/payload-03.js
// ==/UserScript==

// ============================================================
// ✅ インストール完了後、ブラウザの「戻る」を1回押してください
// ✅ After installation, tap the browser Back button once.
// ============================================================

(async function () {
  "use strict";
  try {
    const parts = globalThis.__CGLP_GZIP_PARTS__;
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error("Development payload is unavailable.");
    }
    const binary = atob(parts.join(""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const source = await new Response(stream).text();
    globalThis.__CGLP_GZIP_PARTS__ = undefined;
    Function(source)();
  } catch (error) {
    console.error("[ChatGPT Layer Product] loader failed", error);
    alert("ChatGPT Layerの読み込みに失敗しました。ページを再読み込みしてください。\nFailed to load ChatGPT Layer. Reload the page.");
  }
})();
