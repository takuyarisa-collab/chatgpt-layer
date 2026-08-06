// ==UserScript==
// @name         Room Layer Dev
// @name:en      Room Layer Dev
// @name:ja      Room Layer 開発版
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer-product
// @version      0.3.0-dev1
// @description  Create a personal room around ChatGPT with scoped appearance and quick actions.
// @description:ja ChatGPTの見た目と操作環境を、チャットやプロジェクトごとの部屋として整えます。
// @author       Shion Works
// @homepageURL  https://shion-works.itch.io/room-layer
// @supportURL   https://shion-works.itch.io/room-layer
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @noframes
// @require      https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// ==/UserScript==

// ============================================================
// ✅ Room Layerのインストール完了後、ブラウザの「戻る」を1回押してください
// ✅ After installing Room Layer, tap the browser Back button once.
// ============================================================

(async () => {
  "use strict";

  const PAYLOAD_URLS = [
    "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/releases/0.3.0-dev1/payload-01.txt",
    "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/releases/0.3.0-dev1/payload-02.txt"
  ];

  try {
    const parts = await Promise.all(PAYLOAD_URLS.map(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`payload_fetch_failed:${response.status}`);
      }
      return (await response.text()).trim();
    }));

    const binary = atob(parts.join(""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    if (!globalThis.pako?.ungzip) {
      throw new Error("pako_unavailable");
    }

    const source = globalThis.pako.ungzip(bytes, { to: "string" });
    (0, eval)(`${source}\n//# sourceURL=room-layer-0.3.0-dev1.bundle.js`);
  } catch (error) {
    console.error("[Room Layer] bootstrap failed", error);
    globalThis.alert?.(
      "Room Layerの読み込みに失敗しました。ネットワーク接続を確認して再読み込みしてください。\n\n" +
      String(error?.message ?? error)
    );
  }
})();
