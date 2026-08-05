// ==UserScript==
// @name         ChatGPT Layer Auto Back Test
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.0.1
// @description  Tests whether Gear can return from the source page automatically after installation.
// @author       TaC & Shion
// @match        https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/auto-back-test.user.js*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/auto-back-test.user.js
// @updateURL    https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/auto-back-test.meta.js
// ==/UserScript==

(function () {
  "use strict";

  const installerPath = "/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/auto-back-test.user.js";
  const isInstallerPage =
    location.hostname === "raw.githubusercontent.com" &&
    location.pathname === installerPath;

  if (isInstallerPage) {
    window.setTimeout(() => {
      if (window.history.length > 1) {
        window.history.back();
      }
    }, 120);
    return;
  }

  function showToast() {
    if (!document.body || document.getElementById("cgl-auto-back-test-toast")) return;

    const toast = document.createElement("div");
    toast.id = "cgl-auto-back-test-toast";
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
