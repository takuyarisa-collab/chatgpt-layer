(function () {
  "use strict";

  var VERSION = "0.4.0";
  var BUTTON_ID = "gear-chatgpt-tab-switch-button";
  var TOAST_ID = "gear-chatgpt-tab-switch-toast";
  var renderScheduled = false;
  var api = globalThis.browser || globalThis.chrome;

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
    setImportant(style, "position", "fixed");
    setImportant(style, "right", "16px");
    setImportant(style, "bottom", "170px");
    setImportant(style, "z-index", "2147483647");
    setImportant(style, "max-width", "calc(100vw - 32px)");
    setImportant(style, "padding", "9px 12px");
    setImportant(style, "border-radius", "10px");
    setImportant(style, "background", isError ? "#7f1d1d" : "#202024");
    setImportant(style, "color", "#ffffff");
    setImportant(style, "box-shadow", "0 4px 16px rgba(0,0,0,0.45)");
    setImportant(style, "font", "600 12px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
    setImportant(style, "pointer-events", "none");

    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      if (toast && toast.parentNode) toast.remove();
    }, 4200);
  }

  function sendSwitchMessage() {
    return new Promise(function (resolve, reject) {
      if (!api || !api.runtime || typeof api.runtime.sendMessage !== "function") {
        reject(new Error("runtime.sendMessage is unavailable"));
        return;
      }

      try {
        var result = api.runtime.sendMessage(
          { type: "gear-chatgpt-switch-next", version: VERSION },
          function (response) {
            var error = api.runtime && api.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(response);
          }
        );
        if (result && typeof result.then === "function") result.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function switchTab(button) {
    button.disabled = true;
    ensureButton();

    try {
      var result = await sendSwitchMessage();
      if (!result || !result.ok) {
        showToast(result && result.message ? result.message : "タブ切り替えに失敗しました。", true);
        return;
      }
      setTimeout(function () {
        if (!document.hidden) showToast("切り替え要求を送信しました。", false);
      }, 300);
    } catch (error) {
      showToast("切り替え失敗: " + String(error && error.message || error), true);
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
    button.onclick = function () { switchTab(button); };

    var style = button.style;
    setImportant(style, "position", "fixed");
    setImportant(style, "top", "auto");
    setImportant(style, "left", "auto");
    setImportant(style, "right", "160px");
    setImportant(style, "bottom", "120px");
    setImportant(style, "z-index", "2147483647");
    setImportant(style, "box-sizing", "border-box");
    setImportant(style, "display", "grid");
    setImportant(style, "place-items", "center");
    setImportant(style, "width", "40px");
    setImportant(style, "height", "40px");
    setImportant(style, "margin", "0");
    setImportant(style, "padding", "0");
    setImportant(style, "border", "1.5px solid rgba(255,255,255,0.82)");
    setImportant(style, "border-radius", "999px");
    setImportant(style, "background", "#0f766e");
    setImportant(style, "color", "#ffffff");
    setImportant(style, "box-shadow", "0 4px 16px rgba(0,0,0,0.48)");
    setImportant(style, "font-family", "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
    setImportant(style, "font-size", "20px");
    setImportant(style, "font-weight", "800");
    setImportant(style, "line-height", "1");
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
  new MutationObserver(scheduleRender).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
