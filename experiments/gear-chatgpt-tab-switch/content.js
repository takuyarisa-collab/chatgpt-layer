(function () {
  "use strict";

  var VERSION = "0.3.1";
  var BUTTON_ID = "gear-chatgpt-tab-query-button";
  var PANEL_ID = "gear-chatgpt-tab-query-panel";
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

  function removePanel() {
    var existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
  }

  function showPanel(text, isError) {
    if (!document.body) return;
    removePanel();

    var panel = document.createElement("div");
    panel.id = PANEL_ID;

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "診断表示を閉じる");
    close.onclick = removePanel;

    var title = document.createElement("div");
    title.textContent = "Gear Tabs 診断 v" + VERSION;

    var body = document.createElement("pre");
    body.textContent = text;

    panel.appendChild(close);
    panel.appendChild(title);
    panel.appendChild(body);
    document.body.appendChild(panel);

    var style = panel.style;
    setImportant(style, "position", "fixed");
    setImportant(style, "left", "12px");
    setImportant(style, "right", "12px");
    setImportant(style, "bottom", "174px");
    setImportant(style, "z-index", "2147483647");
    setImportant(style, "box-sizing", "border-box");
    setImportant(style, "max-height", "48vh");
    setImportant(style, "overflow", "auto");
    setImportant(style, "padding", "12px 42px 12px 12px");
    setImportant(style, "border", "1px solid rgba(255,255,255,0.3)");
    setImportant(style, "border-radius", "12px");
    setImportant(style, "background", isError ? "#7f1d1d" : "#18181b");
    setImportant(style, "color", "#ffffff");
    setImportant(style, "box-shadow", "0 8px 28px rgba(0,0,0,0.55)");
    setImportant(style, "font", "600 12px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
    setImportant(style, "opacity", "1");
    setImportant(style, "visibility", "visible");

    setImportant(close.style, "position", "absolute");
    setImportant(close.style, "top", "6px");
    setImportant(close.style, "right", "8px");
    setImportant(close.style, "width", "30px");
    setImportant(close.style, "height", "30px");
    setImportant(close.style, "border", "0");
    setImportant(close.style, "background", "transparent");
    setImportant(close.style, "color", "#ffffff");
    setImportant(close.style, "font", "700 24px/1 sans-serif");

    setImportant(title.style, "margin", "0 0 8px");
    setImportant(title.style, "font-weight", "800");

    setImportant(body.style, "margin", "0");
    setImportant(body.style, "white-space", "pre-wrap");
    setImportant(body.style, "overflow-wrap", "anywhere");
    setImportant(body.style, "font", "600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace");
    setImportant(body.style, "color", "#ffffff");
  }

  function inspectTabs() {
    return new Promise(function (resolve, reject) {
      if (!document.body) {
        reject(new Error("document.body is unavailable"));
        return;
      }

      var requestId = "inspect-" + Date.now() + "-" + Math.random().toString(36).slice(2);
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
        if (!data || data.source !== "gear-chatgpt-tab-query-bridge") return;
        if (data.type !== "result" || data.requestId !== requestId) return;
        finish(null, data.payload);
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
              source: "gear-chatgpt-tab-query-content",
              type: "inspect-tabs",
              requestId: requestId
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

  async function runDiagnostic(button) {
    button.disabled = true;
    ensureButton();

    try {
      var result = await inspectTabs();
      if (!result || !result.ok) {
        showPanel(result && result.message ? result.message : "タブ情報を取得できませんでした。", true);
        return;
      }

      var lines = [
        "total=" + result.totalCount + " chatgpt=" + result.chatgptCount,
        "",
        result.tabs.length ? result.tabs.join("\n") : "ChatGPTタブは検出されませんでした。",
        "",
        "※この版は切替・再読み込みを行いません。"
      ];
      showPanel(lines.join("\n"), false);
    } catch (error) {
      showPanel("診断に失敗しました: " + String(error && error.message || error), true);
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
      button.textContent = "?";
      document.body.appendChild(button);
    } else if (button.parentElement !== document.body) {
      document.body.appendChild(button);
    }

    button.setAttribute("aria-label", "Gearのタブ一覧を診断する v" + VERSION);
    button.setAttribute("title", "Gearのタブ一覧を診断する v" + VERSION);
    button.hidden = false;
    button.removeAttribute("aria-hidden");
    button.onclick = function () {
      runDiagnostic(button);
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
    setImportant(style, "background", "#92400e");
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
  new MutationObserver(scheduleRender).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
