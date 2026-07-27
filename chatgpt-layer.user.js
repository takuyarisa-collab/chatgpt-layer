// ==UserScript==
// @name         ChatGPT Layer Loader
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.2.0
// @description  Load the latest ChatGPT Layer runtime from GitHub.
// @author       TaC & Shion
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.meta.js
// @downloadURL  https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.user.js
// ==/UserScript==

(() => {
  "use strict";

  const REMOTE_URL =
    "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.remote.js";
  const CACHE_KEY = "chatgpt-layer:last-good-runtime";
  const REMOTE_MARKER = "CHATGPT_LAYER_REMOTE";
  const ERROR_BADGE_ID = "chatgpt-layer-loader-error";

  function validateRuntime(code) {
    if (typeof code !== "string" || !code.includes(REMOTE_MARKER)) {
      throw new Error("取得したファイルがChatGPT Layer本体ではありません。");
    }
    return code;
  }

  function requestWithLegacyGM(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: { "Cache-Control": "no-cache" },
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }
          reject(new Error(`GitHub returned HTTP ${response.status}`));
        },
        onerror() {
          reject(new Error("GitHubから本体を取得できませんでした。"));
        },
        ontimeout() {
          reject(new Error("GitHubからの取得がタイムアウトしました。"));
        },
        timeout: 10000,
      });
    });
  }

  async function requestRuntime() {
    const url = `${REMOTE_URL}?t=${Date.now()}`;

    if (typeof GM_xmlhttpRequest === "function") {
      return requestWithLegacyGM(url);
    }

    if (globalThis.GM?.xmlHttpRequest) {
      const response = await globalThis.GM.xmlHttpRequest({
        method: "GET",
        url,
        headers: { "Cache-Control": "no-cache" },
        timeout: 10000,
      });

      if (response.status >= 200 && response.status < 300) {
        return response.responseText;
      }
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }

    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
    });

    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }

    return response.text();
  }

  function executeRuntime(code, sourceLabel) {
    const validatedCode = validateRuntime(code);
    // This repository is the single trusted source for the runtime.
    // Direct eval keeps execution inside the userscript environment.
    eval(`${validatedCode}\n//# sourceURL=${sourceLabel}`);
  }

  function readCachedRuntime() {
    try {
      return localStorage.getItem(CACHE_KEY);
    } catch {
      return null;
    }
  }

  function writeCachedRuntime(code) {
    try {
      localStorage.setItem(CACHE_KEY, code);
    } catch {
      // The live runtime still works even if storage is unavailable.
    }
  }

  function showLoaderError(error) {
    const install = () => {
      if (!document.body || document.getElementById(ERROR_BADGE_ID)) return;

      const button = document.createElement("button");
      button.id = ERROR_BADGE_ID;
      button.type = "button";
      button.textContent = "Layer読込失敗";
      button.setAttribute("aria-label", "ChatGPT Layerの読込エラーを表示");
      Object.assign(button.style, {
        position: "fixed",
        right: "14px",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 94px)",
        zIndex: "2147483647",
        border: "1px solid rgba(255, 190, 190, 0.75)",
        borderRadius: "999px",
        padding: "10px 14px",
        background: "rgba(145, 38, 38, 0.94)",
        color: "white",
        font: '600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      });
      button.addEventListener("click", () => {
        window.alert(`[ChatGPT Layer]\n${error.message || String(error)}`);
      });
      document.body.appendChild(button);
    };

    install();
    document.addEventListener("DOMContentLoaded", install, { once: true });
  }

  async function start() {
    try {
      const remoteCode = validateRuntime(await requestRuntime());
      writeCachedRuntime(remoteCode);
      executeRuntime(remoteCode, REMOTE_URL);
      return;
    } catch (remoteError) {
      console.warn("[ChatGPT Layer] Remote load failed; trying cache.", remoteError);

      const cachedCode = readCachedRuntime();
      if (cachedCode) {
        try {
          executeRuntime(cachedCode, "chatgpt-layer.cached.js");
          return;
        } catch (cacheError) {
          console.error("[ChatGPT Layer] Cached runtime failed.", cacheError);
        }
      }

      showLoaderError(remoteError);
    }
  }

  start();
})();
