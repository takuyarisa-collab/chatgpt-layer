(function () {
  "use strict";

  var api = globalThis.browser || globalThis.chrome;
  var CHATGPT_URL_PATTERN = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i;

  function queryTabs(queryInfo) {
    if (globalThis.browser && browser.tabs && browser.tabs.query) {
      return browser.tabs.query(queryInfo);
    }

    return new Promise(function (resolve, reject) {
      if (!globalThis.chrome || !chrome.tabs || !chrome.tabs.query) {
        reject(new Error("tabs.query is unavailable"));
        return;
      }

      chrome.tabs.query(queryInfo, function (tabs) {
        var error = chrome.runtime && chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(tabs || []);
      });
    });
  }

  function activateTab(tabId) {
    if (globalThis.browser && browser.tabs && browser.tabs.update) {
      return browser.tabs.update(tabId, { active: true });
    }

    return new Promise(function (resolve, reject) {
      if (!globalThis.chrome || !chrome.tabs || !chrome.tabs.update) {
        reject(new Error("tabs.update is unavailable"));
        return;
      }

      chrome.tabs.update(tabId, { active: true }, function (tab) {
        var error = chrome.runtime && chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(tab);
      });
    });
  }

  async function switchToNextChatGPTTab(sender) {
    var sourceTab = sender && sender.tab;
    if (!sourceTab || typeof sourceTab.id !== "number") {
      return {
        ok: false,
        message: "現在のタブ情報を取得できませんでした。"
      };
    }

    var queryInfo = {};
    if (typeof sourceTab.windowId === "number") {
      queryInfo.windowId = sourceTab.windowId;
    } else {
      queryInfo.currentWindow = true;
    }

    var tabs = await queryTabs(queryInfo);
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
      return tab.id === sourceTab.id;
    });

    if (currentIndex < 0) {
      currentIndex = candidates.findIndex(function (tab) {
        return tab.active;
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

  if (!api || !api.runtime || !api.runtime.onMessage) return;

  api.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "gear-switch-next-chatgpt-tab") return;

    switchToNextChatGPTTab(sender)
      .then(function (result) {
        sendResponse(result);
      })
      .catch(function (error) {
        sendResponse({
          ok: false,
          message: "タブAPIを利用できません: " + String(error && error.message || error)
        });
      });

    return true;
  });
})();
