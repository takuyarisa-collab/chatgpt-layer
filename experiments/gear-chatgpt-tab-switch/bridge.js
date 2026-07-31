(function () {
  "use strict";

  var VERSION = "0.3.1";
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

  function shortUrl(url) {
    if (typeof url !== "string") return "?";
    var chatMatch = url.match(/\/c\/([a-z0-9-]{8,128})/i);
    if (chatMatch) return "c/" + chatMatch[1].slice(0, 8);
    return url.replace(/^https:\/\/[^/]+/i, "").slice(0, 36) || "/";
  }

  function describeTab(tab, ordinal) {
    if (!tab) return "#" + ordinal + " unknown";
    return [
      "#" + ordinal,
      "id=" + String(tab.id),
      "win=" + String(tab.windowId),
      "idx=" + String(tab.index),
      "active=" + String(Boolean(tab.active)),
      "url=" + shortUrl(tab.url)
    ].join(" ");
  }

  function sendResult(requestId, payload) {
    parent.postMessage(
      {
        source: "gear-chatgpt-tab-query-bridge",
        type: "result",
        requestId: requestId,
        payload: payload
      },
      "*"
    );
  }

  async function inspectTabs() {
    var tabs = await queryTabs({});
    var chatgptTabs = tabs.filter(function (tab) {
      return tab && typeof tab.url === "string" && CHATGPT_URL_PATTERN.test(tab.url);
    });

    return {
      ok: true,
      version: VERSION,
      totalCount: tabs.length,
      chatgptCount: chatgptTabs.length,
      currentWindowCount: tabs.filter(function (tab) { return Boolean(tab && tab.active); }).length,
      tabs: chatgptTabs.map(function (tab, index) {
        return describeTab(tab, index + 1);
      })
    };
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== parent) return;
    if (!data || data.source !== "gear-chatgpt-tab-query-content") return;
    if (data.type !== "inspect-tabs") return;

    inspectTabs()
      .then(function (result) {
        sendResult(data.requestId, result);
      })
      .catch(function (error) {
        sendResult(data.requestId, {
          ok: false,
          version: VERSION,
          message: "tabs.queryに失敗しました: " + String(error && error.message || error)
        });
      });
  });
})();
