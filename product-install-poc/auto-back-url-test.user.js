// ==UserScript==
// @name         ChatGPT Layer URL Auto Back Test
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.0.2
// @description  Return from the raw UserScript page after Gear installation.
// @author       TaC & Shion
// @match        https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/auto-back-url-test.user.js
// @updateURL    https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/auto-back-url-test.meta.js
// ==/UserScript==

(function () {
  "use strict";

  const INSTALLER_HOST = "raw.githubusercontent.com";
  const INSTALLER_PATH = "/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/auto-back-url-test.user.js";

  const isInstallerSourcePage =
    window.location.hostname === INSTALLER_HOST &&
    window.location.pathname === INSTALLER_PATH;

  if (isInstallerSourcePage) {
    window.setTimeout(() => {
      if (window.history.length > 1) {
        window.history.back();
      }
    }, 250);
    return;
  }

  if (!/^chat(?:gpt)?\.openai\.com$/.test(window.location.hostname) && window.location.hostname !== "chatgpt.com") {
    return;
  }

  function showToast() {
    if (!document.body || document.getElementById("cgl-url-auto-back-test-toast")) return;

    const toast = document.createElement("div");
    toast.id = "cgl-url-auto-back-test-toast";
    toast.textContent = "ChatGPT Layer: Install + Auto Back OK";
    Object.assign(toast.style, {
      position: "fixed",
      left: "50%",
      bottom: "110px",
      zIndex: "2147483647",
      transform: "translateX(-50%)",
      maxWidth: "calc(100vw - 32px)",
      padding: "10px 14px",
      borderRadius: "999px",
      background: "#111827",
      color: "#ffffff",
      font: "600 14px -apple-system, BlinkMacSystemFont, sans-serif",
      textAlign: "center",
      boxShadow: "0 8px 28px rgba(0,0,0,.35)",
      pointerEvents: "none"
    });

    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showToast, { once: true });
  } else {
    showToast();
  }
})();
