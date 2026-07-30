(function () {
  "use strict";

  var CHATGPT_URL_PATTERN = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i;

  function queryTabs(queryInfo) {
    return new Promise(function (resolve, reject) {
      if (globalThis.chrome && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query(queryInfo, function (tabs) {
          var error = chrome.runtime && chrome.runtime.lastError;
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

  function activateTab(tabId) {
    return new Promise(function (resolve, reject) {
      if (globalThis.chrome && chrome.tabs && chrome.tabs.update) {
        chrome.tabs.update(tabId, { active: true }, function (tab) {
          var error = chrome.runtime && chrome.runtime.lastError;
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

  async function switchToNextChatGPTTab() {
    var tabs = await queryTabs({ currentWindow: true });
    var candidates = tabs
      .filter(function (tab) {
        return (
          typeof tab.id === "number" &&
          typeof tab.url === "string" &&
          CHATGPT_URL_PATTERN.test(tab.url)
        );
      })
      .sort(function (left, right) {
        return Number(left.index || 0) - Number(right.index || 0);
      });

    if (candidates.length < 2) {
      return {
        ok: false,
        message: "切替先のChatGPTタブがありません。2枚以上開いてください。"
      };
    }

    var currentIndex = candidates.findIndex(function (tab) {
      return tab.active;
    });

    if (currentIndex < 0 && document.referrer) {
      currentIndex = candidates.findIndex(function (tab) {
        return tab.url === document.referrer;
      });
    }

    if (currentIndex < 0) currentIndex = 0;

    var target = candidates[(currentIndex + 1) % candidates.length];
    await activateTab(target.id);

    return {
      ok: true,
      targetTabId: target.id,
      targetTitle: target.title || "ChatGPT"
    };
  }

  function sendResult(requestId, result) {
    try {
      parent.postMessage(
        {
          source: "gear-chatgpt-tab-switch-bridge",
          type: "result",
          requestId: requestId,
          result: result
        },
        "*"
      );
    } catch (error) {
      // The target tab may already be inactive after a successful switch.
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== parent) return;
    if (!data || data.source !== "gear-chatgpt-tab-switch-content") return;
    if (data.type !== "switch-next-chatgpt-tab") return;

    switchToNextChatGPTTab()
      .then(function (result) {
        sendResult(data.requestId, result);
      })
      .catch(function (error) {
        sendResult(data.requestId, {
          ok: false,
          message: "タブAPIを利用できません: " + String(error && error.message || error)
        });
      });
  });
})();
