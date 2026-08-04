// ==UserScript==
// @name         ChatGPT Layer Install Test
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer
// @version      0.0.1
// @description  Harmless installation-flow test for Gear Browser.
// @author       TaC & Shion
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/install-test.user.js
// @updateURL    https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/install-test.meta.js
// ==/UserScript==

(function () {
  "use strict";

  if (document.getElementById("cgl-install-test-toast")) return;

  const toast = document.createElement("div");
  toast.id = "cgl-install-test-toast";
  toast.textContent = "ChatGPT Layer: Install OK";
  Object.assign(toast.style, {
    position: "fixed",
    left: "50%",
    bottom: "110px",
    zIndex: "2147483647",
    transform: "translateX(-50%)",
    padding: "10px 14px",
    borderRadius: "999px",
    background: "#111827",
    color: "#ffffff",
    font: "600 14px -apple-system, BlinkMacSystemFont, sans-serif",
    boxShadow: "0 8px 28px rgba(0,0,0,.35)",
    pointerEvents: "none"
  });

  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 5000);
})();
