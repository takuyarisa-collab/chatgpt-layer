(function () {
  "use strict";

  var api = globalThis.browser || globalThis.chrome;

  function isChatGPTUrl(url) {
    return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(String(url || ""));
  }

  function callTabsQuery(queryInfo) {
    return new Promise(function (resolve, reject) {
      try {
        var result = api.tabs.query(queryInfo, function (tabs) {
          var error = api.runtime && api.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(tabs || []);
        });
        if (result && typeof result.then === "function") result.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  function callTabsUpdate(tabId, updateProperties) {
    return new Promise(function (resolve, reject) {
      try {
        var result = api.tabs.update(tabId, updateProperties, function (tab) {
          var error = api.runtime && api.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(tab || null);
        });
        if (result && typeof result.then === "function") result.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function switchToNextChatGPTTab(sender) {
    var senderTab = sender && sender.tab ? sender.tab : null;
    var allTabs = await callTabsQuery({});
    var windowId = senderTab && Number.isInteger(senderTab.windowId)
      ? senderTab.windowId
      : null;

    var tabs = allTabs.filter(function (tab) {
      if (!tab || !Number.isInteger(tab.id) || !isChatGPTUrl(tab.url || tab.pendingUrl)) return false;
      return windowId === null || tab.windowId === windowId;
    }).sort(function (left, right) {
      return Number(left.index || 0) - Number(right.index || 0);
    });

    if (tabs.length < 2) {
      return {
        ok: false,
        code: "NOT_ENOUGH_TABS",
        message: "同じウィンドウにChatGPTタブが2枚以上必要です。",
        count: tabs.length
      };
    }

    var currentId = senderTab && Number.isInteger(senderTab.id) ? senderTab.id : null;
    var currentIndex = tabs.findIndex(function (tab) { return tab.id === currentId; });

    if (currentIndex < 0) {
      currentIndex = tabs.findIndex(function (tab) { return tab.active; });
    }

    var target = tabs[(currentIndex + 1 + tabs.length) % tabs.length];
    if (!target || target.id === currentId) {
      return {
        ok: false,
        code: "TARGET_NOT_FOUND",
        message: "切り替え先のChatGPTタブを特定できませんでした。"
      };
    }

    await callTabsUpdate(target.id, { active: true });

    return {
      ok: true,
      targetId: target.id,
      targetIndex: target.index,
      targetTitle: target.title || "ChatGPT",
      targetUrl: target.url || "",
      count: tabs.length
    };
  }

  if (!api || !api.runtime || !api.runtime.onMessage || !api.tabs) return;

  api.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "chatgpt-layer-switch-next-tab") return false;

    switchToNextChatGPTTab(sender)
      .then(function (result) { sendResponse(result); })
      .catch(function (error) {
        sendResponse({
          ok: false,
          code: "SWITCH_FAILED",
          message: String(error && error.message || error)
        });
      });

    return true;
  });
})();
