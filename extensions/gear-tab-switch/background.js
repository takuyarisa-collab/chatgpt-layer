(function () {
  "use strict";

  var api = globalThis.browser || globalThis.chrome;
  var LATEST_URL = "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/extensions/gear-tab-switch/latest.json";

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

  function compareVersions(left, right) {
    var a = String(left || "0").split(".").map(function (part) { return Number(part) || 0; });
    var b = String(right || "0").split(".").map(function (part) { return Number(part) || 0; });
    var length = Math.max(a.length, b.length);
    for (var index = 0; index < length; index += 1) {
      var av = a[index] || 0;
      var bv = b[index] || 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  async function fetchLatestVersion() {
    var response = await fetch(LATEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("latest.json: HTTP " + response.status);

    var data = await response.json();
    var version = String(data && data.version || "");
    var crx = String(data && data.crx || "");

    if (!/^\d+(?:\.\d+){1,3}$/.test(version)) {
      throw new Error("Invalid latest version");
    }

    if (!/^https:\/\/raw\.githubusercontent\.com\/takuyarisa-collab\/chatgpt-layer\/main\/extensions\/gear-tab-switch\/releases\/[A-Za-z0-9._-]+\.crx$/i.test(crx)) {
      throw new Error("Invalid CRX URL");
    }

    var current = api.runtime.getManifest().version;
    return {
      ok: true,
      currentVersion: current,
      latestVersion: version,
      updateAvailable: compareVersions(current, version) < 0,
      crx: crx
    };
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
    if (!message || !message.type) return false;

    var task;
    if (message.type === "chatgpt-layer-switch-next-tab") {
      task = switchToNextChatGPTTab(sender);
    } else if (message.type === "chatgpt-layer-check-tab-switch-update") {
      task = fetchLatestVersion();
    } else {
      return false;
    }

    task.then(function (result) {
      sendResponse(result);
    }).catch(function (error) {
      sendResponse({
        ok: false,
        code: message.type === "chatgpt-layer-check-tab-switch-update"
          ? "UPDATE_CHECK_FAILED"
          : "SWITCH_FAILED",
        message: String(error && error.message || error)
      });
    });

    return true;
  });
})();
