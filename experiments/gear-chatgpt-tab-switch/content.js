(function () {
  "use strict";

  var VERSION = "0.3.0";
  var BUTTON_ID = "gear-chatgpt-tab-switch-button";
  var MESSAGE_ID = "gear-chatgpt-tab-switch-message";
  var DEBUG_KEY = "gear-chatgpt-tab-switch:last-plan:v030";
  var renderScheduled = false;

  function setImportant(style, property, value) {
    style.setProperty(property, value, "important");
  }

  function getRuntimeUrl(path) {
    if (globalThis.chrome && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL(path);
    }
    if (globalThis.browser && browser.runtime && browser.runtime.getURL) {
      return browser.runtime.getURL(path);
    }
    throw new Error("runtime.getURL is unavailable");
  }

  function saveDebug(value) {
    try {
      localStorage.setItem(DEBUG_KEY, JSON.stringify(value));
    } catch (error) {
      // Continue without persistent diagnostics.
    }
  }

  function readDebug() {
    try {
      var value = JSON.parse(localStorage.getItem(DEBUG_KEY) || "null");
      if (!value || typeof value.timestamp !== "number") return null;
      if (Date.now() - value.timestamp > 20000) return null;
      return value;
    } catch (error) {
      return null;
    }
  }

  function clearDebug() {
    try {
      localStorage.removeItem(DEBUG_KEY);
    } catch (error) {
      // Ignore.
    }
  }

  function showMessage(text, isError, duration) {
    if (!document.body) return;

    var message = document.getElementById(MESSAGE_ID);
    if (!message) {
      message = document.createElement("div");
      message.id = MESSAGE_ID;
      document.body.appendChild(message);
    }

    message.textContent = text;
    var style = message.style;
    setImportant(style, "position", "fixed");
    setImportant(style, "right", "16px");
    setImportant(style, "bottom", "168px");
    setImportant(style, "z-index", "2147483647");
    setImportant(style, "max-width", "calc(100vw - 32px)");
    setImportant(style, "padding", "9px 12px");
    setImportant(style, "border-radius", "10px");
    setImportant(style, "background", isError ? "#7f1d1d" : "#202024");
    setImportant(style, "color", "#ffffff");
    setImportant(style, "box-shadow", "0 4px 16px rgba(0,0,0,0.45)");
    setImportant(style, "font", "600 12px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
    setImportant(style, "opacity", "1");
    setImportant(style, "visibility", "visible");

    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(function () {
      if (message && message.parentNode) message.remove();
    }, duration || 6500);
  }

  function requestTabSwitch() {
    return new Promise(function (resolve, reject) {
      if (!document.body) {
        reject(new Error("document.body is unavailable"));
        return;
      }

      var requestId = "switch-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      var frame = document.createElement("iframe");
      var settled = false;
      var timeoutId = 0;

      function cleanup() {
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timeoutId);
        if (frame && frame.parentNode) frame.remove();
      }

      function finish(error, result) {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(result);
      }

      function onMessage(event) {
        var data = event.data;
        if (event.source !== frame.contentWindow) return;
        if (!data || data.source !== "gear-chatgpt-tab-switch-bridge") return;
        if (data.requestId !== requestId) return;

        if (data.type === "plan") {
          var plan = data.payload || {};
          var text = "v" + VERSION + " 診断: " + plan.source + " → " + plan.target + "（" + plan.candidateCount + "枚）";
          saveDebug({ timestamp: Date.now(), phase: "plan", text: text });
          showMessage(text, false, 9000);
          return;
        }

        if (data.type === "result") {
          finish(null, data.payload);
        }
      }

      window.addEventListener("message", onMessage);

      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.src = getRuntimeUrl("bridge.html");
      setImportant(frame.style, "position", "fixed");
      setImportant(frame.style, "width", "1px");
      setImportant(frame.style, "height", "1px");
      setImportant(frame.style, "right", "0");
      setImportant(frame.style, "bottom", "0");
      setImportant(frame.style, "border", "0");
      setImportant(frame.style, "opacity", "0");
      setImportant(frame.style, "pointer-events", "none");

      frame.onload = function () {
        try {
          frame.contentWindow.postMessage(
            {
              source: "gear-chatgpt-tab-switch-content",
              type: "switch-next-chatgpt-tab",
              requestId: requestId,
              currentUrl: location.href,
              currentTitle: document.title
            },
            "*"
          );
        } catch (error) {
          finish(error);
        }
      };

      frame.onerror = function () {
        finish(new Error("bridge.htmlを読み込めませんでした"));
      };

      timeoutId = window.setTimeout(function () {
        finish(new Error("拡張機能ページから応答がありません"));
      }, 6000);

      document.body.appendChild(frame);
    });
  }

  async function switchTab(button) {
    button.disabled = true;
    ensureButton();
    clearDebug();

    try {
      var result = await requestTabSwitch();
      if (!result || !result.ok) {
        showMessage(result && result.message ? result.message : "v" + VERSION + ": タブを切り替えられませんでした。", true, 9000);
        return;
      }

      saveDebug({ timestamp: Date.now(), phase: "result", text: result.message || "切替要求を送信しました" });
      showMessage(result.message || "切替要求を送信しました", false, 9000);
    } catch (error) {
      showMessage("v" + VERSION + ": タブ切替に失敗しました: " + String(error && error.message || error), true, 9000);
    } finally {
      button.disabled = false;
      ensureButton();
    }
  }

  function ensureButton() {
    if (!document.body) return;

    var button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "⇄";
      document.body.appendChild(button);
    } else if (button.parentElement !== document.body) {
      document.body.appendChild(button);
    }

    button.setAttribute("aria-label", "次のChatGPTタブへ切り替える v" + VERSION);
    button.setAttribute("title", "次のChatGPTタブへ切り替える v" + VERSION);
    button.hidden = false;
    button.removeAttribute("aria-hidden");
    button.onclick = function () {
      switchTab(button);
    };

    var style = button.style;
    setImportant(style, "position", "fixed");
    setImportant(style, "top", "auto");
    setImportant(style, "left", "auto");
    setImportant(style, "right", "112px");
    setImportant(style, "bottom", "120px");
    setImportant(style, "z-index", "2147483647");
    setImportant(style, "box-sizing", "border-box");
    setImportant(style, "display", "grid");
    setImportant(style, "place-items", "center");
    setImportant(style, "width", "40px");
    setImportant(style, "min-width", "40px");
    setImportant(style, "max-width", "40px");
    setImportant(style, "height", "40px");
    setImportant(style, "min-height", "40px");
    setImportant(style, "max-height", "40px");
    setImportant(style, "margin", "0");
    setImportant(style, "padding", "0");
    setImportant(style, "border", "1.5px solid rgba(255,255,255,0.82)");
    setImportant(style, "border-radius", "999px");
    setImportant(style, "background", "#312e81");
    setImportant(style, "color", "#ffffff");
    setImportant(style, "box-shadow", "0 4px 16px rgba(0,0,0,0.48)");
    setImportant(style, "font-family", "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
    setImportant(style, "font-size", "20px");
    setImportant(style, "font-weight", "800");
    setImportant(style, "line-height", "1");
    setImportant(style, "text-align", "center");
    setImportant(style, "opacity", button.disabled ? "0.55" : "1");
    setImportant(style, "visibility", "visible");
    setImportant(style, "pointer-events", "auto");
    setImportant(style, "appearance", "none");
    setImportant(style, "-webkit-appearance", "none");
    setImportant(style, "touch-action", "manipulation");
    setImportant(style, "-webkit-tap-highlight-color", "transparent");
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(function () {
      renderScheduled = false;
      ensureButton();
    });
  }

  ensureButton();

  var recentDebug = readDebug();
  if (recentDebug && recentDebug.phase === "plan") {
    showMessage(recentDebug.text + "。現在タブが再読込された可能性があります。", true, 12000);
  }

  new MutationObserver(scheduleRender).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
