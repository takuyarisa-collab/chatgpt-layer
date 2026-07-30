(function () {
  "use strict";

  var VERSION = "0.3.0";
  var CHATGPT_URL_PATTERN = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i;

  function getLastError() {
    return globalThis.chrome && chrome.runtime ? chrome.runtime.lastError : null;
  }

  function queryTabs(queryInfo) {
    return new Promise(function (resolve, reject) {
      if (globalThis.chrome && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query(queryInfo, function (tabs) {
          var error = getLastError();
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(tabs || []);
        });
        return;
      }

      if (globalThis.browser && browser.tabs && browser.tabs.query) {
        Promise.resolve(browser.tabs.query(queryInfo)).then(resolve, reject);
        return;
      }

      reject(new Error("tabs.query is unavailable"));
    });
  }

  function highlightTab(windowId, index) {
    return new Promise(function (resolve, reject) {
      var info = { tabs: index };
      if (typeof windowId === "number") info.windowId = windowId;

      if (globalThis.chrome && chrome.tabs && chrome.tabs.highlight) {
        chrome.tabs.highlight(info, function (windowInfo) {
          var error = getLastError();
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(windowInfo);
        });
        return;
      }

      if (globalThis.browser && browser.tabs && browser.tabs.highlight) {
        Promise.resolve(browser.tabs.highlight(info)).then(resolve, reject);
        return;
      }

      reject(new Error("tabs.highlight is unavailable"));
    });
  }

  function activateTab(tabId) {
    return new Promise(function (resolve, reject) {
      if (globalThis.chrome && chrome.tabs && chrome.tabs.update) {
        chrome.tabs.update(tabId, { active: true }, function (tab) {
          var error = getLastError();
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(tab);
        });
        return;
      }

      if (globalThis.browser && browser.tabs && browser.tabs.update) {
        Promise.resolve(browser.tabs.update(tabId, { active: true })).then(resolve, reject);
        return;
      }

      reject(new Error("tabs.update is unavailable"));
    });
  }

  function focusWindow(windowId) {
    if (typeof windowId !== "number") return Promise.resolve();

    return new Promise(function (resolve) {
      if (globalThis.chrome && chrome.windows && chrome.windows.update) {
        chrome.windows.update(windowId, { focused: true }, function () {
          void getLastError();
          resolve();
        });
        return;
      }

      if (globalThis.browser && browser.windows && browser.windows.update) {
        Promise.resolve(browser.windows.update(windowId, { focused: true })).then(
          function () { resolve(); },
          function () { resolve(); }
        );
        return;
      }

      resolve();
    });
  }

  function normalizeCandidates(tabs) {
    var byId = {};

    tabs.forEach(function (tab) {
      if (!tab || typeof tab.id !== "number") return;
      if (typeof tab.url !== "string" || !CHATGPT_URL_PATTERN.test(tab.url)) return;
      byId[String(tab.id)] = tab;
    });

    return Object.keys(byId)
      .map(function (key) { return byId[key]; })
      .sort(function (left, right) {
        var leftWindow = Number(left.windowId || 0);
        var rightWindow = Number(right.windowId || 0);
        if (leftWindow !== rightWindow) return leftWindow - rightWindow;
        return Number(left.index || 0) - Number(right.index || 0);
      });
  }

  function shortUrl(url) {
    if (typeof url !== "string") return "?";
    var match = url.match(/\/c\/([a-z0-9-]{8,128})/i);
    if (match) return "c/" + match[1].slice(0, 8);
    return url.replace(/^https:\/\/[^/]+/i, "").slice(0, 32) || "/";
  }

  function describeTab(tab) {
    if (!tab) return "unknown";
    return "id=" + tab.id + " index=" + tab.index + " " + shortUrl(tab.url);
  }

  function sendBridgeMessage(requestId, type, payload) {
    try {
      parent.postMessage(
        {
          source: "gear-chatgpt-tab-switch-bridge",
          type: type,
          requestId: requestId,
          payload: payload
        },
        "*"
      );
    } catch (error) {
      // The source tab may no longer be active after a successful switch.
    }
  }

  async function switchToNextChatGPTTab(data) {
    var allTabs = await queryTabs({});
    var candidates = normalizeCandidates(allTabs);

    if (candidates.length < 2) {
      return {
        ok: false,
        message: "v" + VERSION + ": ChatGPTタブを2枚以上検出できませんでした（検出" + candidates.length + "枚）"
      };
    }

    var sourceIndex = candidates.findIndex(function (tab) {
      return tab.url === data.currentUrl && tab.active;
    });

    if (sourceIndex < 0) {
      sourceIndex = candidates.findIndex(function (tab) {
        return tab.url === data.currentUrl;
      });
    }

    if (sourceIndex < 0) {
      sourceIndex = candidates.findIndex(function (tab) {
        return Boolean(tab.active);
      });
    }

    if (sourceIndex < 0) sourceIndex = 0;

    var source = candidates[sourceIndex];
    var target = candidates[(sourceIndex + 1) % candidates.length];

    if (!target || target.id === source.id) {
      return {
        ok: false,
        message: "v" + VERSION + ": 切替先が現在タブと同一です。" + describeTab(source)
      };
    }

    var plan = {
      version: VERSION,
      candidateCount: candidates.length,
      source: describeTab(source),
      target: describeTab(target)
    };

    sendBridgeMessage(data.requestId, "plan", plan);

    var method = "highlight";
    try {
      await highlightTab(target.windowId, target.index);
      await focusWindow(target.windowId);
    } catch (highlightError) {
      method = "update";
      await activateTab(target.id);
      await focusWindow(target.windowId);
      plan.highlightError = String(highlightError && highlightError.message || highlightError);
    }

    return {
      ok: true,
      version: VERSION,
      method: method,
      source: plan.source,
      target: plan.target,
      message: "v" + VERSION + ": " + method + "で " + plan.target + " へ切替要求を送信しました"
    };
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== parent) return;
    if (!data || data.source !== "gear-chatgpt-tab-switch-content") return;
    if (data.type !== "switch-next-chatgpt-tab") return;

    switchToNextChatGPTTab(data)
      .then(function (result) {
        sendBridgeMessage(data.requestId, "result", result);
      })
      .catch(function (error) {
        sendBridgeMessage(data.requestId, "result", {
          ok: false,
          message: "v" + VERSION + ": タブAPIを利用できません: " + String(error && error.message || error)
        });
      });
  });
})();
