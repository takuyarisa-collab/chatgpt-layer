(function () {
  "use strict";

  if (window.top !== window.self) return;

  var api = globalThis.browser || globalThis.chrome;
  var VERSION = api && api.runtime && api.runtime.getManifest
    ? api.runtime.getManifest().version
    : "unknown";
  var BUTTON_ID = "chatgpt-layer-tab-switch";
  var UPDATE_ID = "chatgpt-layer-tab-switch-update";
  var TOAST_ID = "chatgpt-layer-tab-switch-toast";
  var UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
  var renderScheduled = false;
  var updateInfo = null;
  var lastUpdateCheck = 0;

  function setImportant(style, property, value) {
    style.setProperty(property, value, "important");
  }

  function showToast(text, isError) {
    if (!document.body) return;

    var toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }

    toast.textContent = text;
    var style = toast.style;
    var values = {
      position: "fixed",
      left: "16px",
      right: "auto",
      bottom: "170px",
      "z-index": "2147483647",
      "max-width": "calc(100vw - 32px)",
      padding: "9px 12px",
      "border-radius": "10px",
      background: isError ? "#7f1d1d" : "#202024",
      color: "#ffffff",
      "box-shadow": "0 4px 16px rgba(0,0,0,0.45)",
      font: "600 12px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      "pointer-events": "none"
    };

    Object.keys(values).forEach(function (property) {
      setImportant(style, property, values[property]);
    });

    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      if (toast && toast.parentNode) toast.remove();
    }, 4200);
  }

  function sendMessage(message) {
    return new Promise(function (resolve, reject) {
      if (!api || !api.runtime || typeof api.runtime.sendMessage !== "function") {
        reject(new Error("runtime.sendMessage is unavailable"));
        return;
      }

      try {
        var settled = false;

        function finish(error, response) {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve(response);
        }

        var result = api.runtime.sendMessage(message, function (response) {
          var error = api.runtime && api.runtime.lastError;
          finish(error ? new Error(error.message) : null, response);
        });

        if (result && typeof result.then === "function") {
          result.then(
            function (response) { finish(null, response); },
            function (error) { finish(error); }
          );
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async function switchTab(button) {
    button.disabled = true;
    ensureControls();

    try {
      var result = await sendMessage({
        type: "chatgpt-layer-switch-next-tab",
        version: VERSION
      });

      if (!result || !result.ok) {
        showToast(
          result && result.message ? result.message : "タブ切り替えに失敗しました。",
          true
        );
      }
    } catch (error) {
      showToast("切り替え失敗: " + String(error && error.message || error), true);
    } finally {
      button.disabled = false;
      ensureControls();
    }
  }

  async function checkForUpdate(force) {
    var now = Date.now();
    if (!force && now - lastUpdateCheck < UPDATE_CHECK_INTERVAL) return;
    lastUpdateCheck = now;

    try {
      var result = await sendMessage({
        type: "chatgpt-layer-check-tab-switch-update",
        version: VERSION
      });

      updateInfo = result && result.ok && result.updateAvailable ? result : null;
      ensureControls();
    } catch (_) {
      updateInfo = null;
      ensureControls();
    }
  }

  function ensureControls() {
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

    var buttonValues = {
      position: "fixed",
      top: "auto",
      left: "16px",
      right: "auto",
      bottom: "120px",
      "z-index": "2147483647",
      "box-sizing": "border-box",
      display: "grid",
      "place-items": "center",
      width: "40px",
      "min-width": "40px",
      "max-width": "40px",
      height: "40px",
      "min-height": "40px",
      "max-height": "40px",
      margin: "0",
      padding: "0",
      border: "1.5px solid rgba(255,255,255,0.82)",
      "border-radius": "999px",
      background: "#0f766e",
      color: "#ffffff",
      "box-shadow": "0 4px 16px rgba(0,0,0,0.48)",
      "font-family": "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      "font-size": "20px",
      "font-weight": "800",
      "line-height": "1",
      "text-align": "center",
      opacity: button.disabled ? "0.55" : "1",
      visibility: "visible",
      "pointer-events": "auto",
      appearance: "none",
      "-webkit-appearance": "none",
      "touch-action": "manipulation",
      "-webkit-tap-highlight-color": "transparent"
    };

    Object.keys(buttonValues).forEach(function (property) {
      setImportant(button.style, property, buttonValues[property]);
    });

    var update = document.getElementById(UPDATE_ID);
    if (!updateInfo) {
      if (update) update.remove();
      return;
    }

    if (!update) {
      update = document.createElement("a");
      update.id = UPDATE_ID;
      update.textContent = "↑";
      update.target = "_blank";
      update.rel = "noopener noreferrer";
      document.body.appendChild(update);
    } else if (update.parentElement !== document.body) {
      document.body.appendChild(update);
    }

    update.href = updateInfo.crx;
    update.setAttribute(
      "aria-label",
      "Tab Switchをv" + updateInfo.latestVersion + "へ更新"
    );
    update.setAttribute("title", "更新あり: v" + updateInfo.latestVersion);
    update.onclick = function () {
      showToast(
        "v" + updateInfo.latestVersion + "を開きます。Gearでインストールしてください。",
        false
      );
    };

    var updateValues = {
      position: "fixed",
      left: "44px",
      right: "auto",
      bottom: "148px",
      "z-index": "2147483647",
      "box-sizing": "border-box",
      display: "grid",
      "place-items": "center",
      width: "22px",
      height: "22px",
      margin: "0",
      padding: "0",
      border: "1.5px solid rgba(255,255,255,0.92)",
      "border-radius": "999px",
      background: "#f59e0b",
      color: "#111827",
      "box-shadow": "0 2px 8px rgba(0,0,0,0.48)",
      "font-family": "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      "font-size": "14px",
      "font-weight": "900",
      "line-height": "1",
      "text-align": "center",
      "text-decoration": "none",
      visibility: "visible",
      "pointer-events": "auto",
      "touch-action": "manipulation",
      "-webkit-tap-highlight-color": "transparent"
    };

    Object.keys(updateValues).forEach(function (property) {
      setImportant(update.style, property, updateValues[property]);
    });
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;

    requestAnimationFrame(function () {
      renderScheduled = false;
      ensureControls();
    });
  }

  ensureControls();
  setTimeout(function () {
    checkForUpdate(true);
  }, 1500);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) checkForUpdate(false);
  });

  new MutationObserver(scheduleRender).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
