(function () {
  "use strict";

  var api = globalThis.browser || globalThis.chrome;
  var PROTOCOL = 1;
  var STORAGE_KEY = "chatgptLayerKnownTabsV1";
  var MAX_RECORDS = 80;
  var MAX_RECORD_AGE = 45 * 24 * 60 * 60 * 1000;
  var memoryRecords = [];
  var rememberQueue = Promise.resolve();

  function isChatGPTUrl(url) {
    return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(String(url || ""));
  }

  function getTabUrl(tab) {
    return String(tab && (tab.url || tab.pendingUrl) || "");
  }

  function normalizeTitle(title) {
    return String(title || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function settleCallbackCall(run) {
    return new Promise(function (resolve, reject) {
      var settled = false;

      function finish(error, value) {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      }

      try {
        var result = run(function (value) {
          var error = api.runtime && api.runtime.lastError;
          finish(error ? new Error(error.message) : null, value);
        });

        if (result && typeof result.then === "function") {
          result.then(
            function (value) { finish(null, value); },
            function (error) { finish(error); }
          );
        }
      } catch (error) {
        finish(error);
      }
    });
  }

  function callTabsQuery(queryInfo) {
    return settleCallbackCall(function (callback) {
      return api.tabs.query(queryInfo, callback);
    }).then(function (tabs) {
      return tabs || [];
    });
  }

  function callTabsUpdate(tabId, updateProperties) {
    return settleCallbackCall(function (callback) {
      return api.tabs.update(tabId, updateProperties, callback);
    }).then(function (tab) {
      return tab || null;
    });
  }

  function callStorageGet(key) {
    if (!api.storage || !api.storage.local || typeof api.storage.local.get !== "function") {
      return Promise.resolve({});
    }

    return settleCallbackCall(function (callback) {
      return api.storage.local.get(key, callback);
    }).then(function (items) {
      return items || {};
    });
  }

  function callStorageSet(items) {
    if (!api.storage || !api.storage.local || typeof api.storage.local.set !== "function") {
      return Promise.resolve();
    }

    return settleCallbackCall(function (callback) {
      return api.storage.local.set(items, callback);
    }).then(function () {});
  }

  function sanitizeRecords(records) {
    var now = Date.now();
    var source = Array.isArray(records) ? records : [];

    return source.filter(function (record) {
      return record &&
        Number.isInteger(record.tabId) &&
        Number.isInteger(record.index) &&
        isChatGPTUrl(record.url) &&
        now - Number(record.lastSeen || 0) <= MAX_RECORD_AGE;
    }).map(function (record) {
      return {
        tabId: record.tabId,
        windowId: Number.isInteger(record.windowId) ? record.windowId : null,
        index: record.index,
        title: String(record.title || ""),
        normalizedTitle: normalizeTitle(record.normalizedTitle || record.title),
        url: String(record.url || ""),
        lastSeen: Number(record.lastSeen || 0)
      };
    }).sort(function (left, right) {
      return right.lastSeen - left.lastSeen;
    }).slice(0, MAX_RECORDS);
  }

  async function loadKnownRecords() {
    try {
      var items = await callStorageGet(STORAGE_KEY);
      var stored = sanitizeRecords(items[STORAGE_KEY]);
      if (stored.length) memoryRecords = stored;
      return stored.length ? stored : memoryRecords.slice();
    } catch (_) {
      return memoryRecords.slice();
    }
  }

  async function saveKnownRecords(records) {
    var clean = sanitizeRecords(records);
    memoryRecords = clean;

    try {
      var items = {};
      items[STORAGE_KEY] = clean;
      await callStorageSet(items);
    } catch (_) {
      // Keep the in-memory copy even when Gear does not expose storage.local.
    }

    return clean;
  }

  function createRecord(tab) {
    var url = getTabUrl(tab);
    if (!tab || !Number.isInteger(tab.id) || !Number.isInteger(tab.index) || !isChatGPTUrl(url)) {
      return null;
    }

    return {
      tabId: tab.id,
      windowId: Number.isInteger(tab.windowId) ? tab.windowId : null,
      index: tab.index,
      title: String(tab.title || ""),
      normalizedTitle: normalizeTitle(tab.title),
      url: url,
      lastSeen: Date.now()
    };
  }

  function mergeKnownRecords(records, tabs) {
    var merged = sanitizeRecords(records).slice();

    (tabs || []).forEach(function (tab) {
      var record = createRecord(tab);
      if (!record) return;

      merged = merged.filter(function (existing) {
        if (existing.tabId === record.tabId) return false;
        return !(
          record.windowId !== null &&
          existing.windowId === record.windowId &&
          existing.index === record.index
        );
      });
      merged.unshift(record);
    });

    return sanitizeRecords(merged);
  }

  function rememberExplicitTabs(tabs) {
    rememberQueue = rememberQueue.then(async function () {
      var records = await loadKnownRecords();
      return saveKnownRecords(mergeKnownRecords(records, tabs));
    }).catch(function () {
      return memoryRecords.slice();
    });

    return rememberQueue;
  }

  function uniqueMatch(records, predicate) {
    var matches = records.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  }

  function findDormantMatch(tab, records, context) {
    if (!tab || !Number.isInteger(tab.id) || getTabUrl(tab)) return null;

    var title = normalizeTitle(tab.title);
    var sameWindow = function (record) {
      return Number.isInteger(tab.windowId) && record.windowId === tab.windowId;
    };

    var exactId = uniqueMatch(records, function (record) {
      return record.tabId === tab.id;
    });
    if (exactId) return { record: exactId, reason: "tab-id" };

    if (title) {
      var sameWindowIndexTitle = uniqueMatch(records, function (record) {
        return sameWindow(record) && record.index === tab.index && record.normalizedTitle === title;
      });
      if (sameWindowIndexTitle) return { record: sameWindowIndexTitle, reason: "window-index-title" };

      if (context.singleWindow) {
        var indexTitle = uniqueMatch(records, function (record) {
          return record.index === tab.index && record.normalizedTitle === title;
        });
        if (indexTitle) return { record: indexTitle, reason: "index-title" };
      }

      var sameWindowTitle = uniqueMatch(records, function (record) {
        return sameWindow(record) && record.normalizedTitle === title;
      });
      if (sameWindowTitle) return { record: sameWindowTitle, reason: "window-title" };
    }

    if (!title && context.singleWindow) {
      var slot = uniqueMatch(records, function (record) {
        return record.index === tab.index;
      });
      if (slot) return { record: slot, reason: "index-only" };
    }

    return null;
  }

  async function registerSenderTab(sender) {
    var senderTab = sender && sender.tab ? sender.tab : null;
    if (!senderTab || !isChatGPTUrl(getTabUrl(senderTab))) {
      return { ok: false, code: "REGISTER_FAILED", registered: false };
    }

    await rememberExplicitTabs([senderTab]);
    return { ok: true, code: "OK", registered: true };
  }

  function createPingResult() {
    return {
      ok: true,
      code: "OK",
      protocol: PROTOCOL,
      extensionVersion: api.runtime.getManifest().version
    };
  }

  async function switchToNextChatGPTTab(sender) {
    var senderTab = sender && sender.tab ? sender.tab : null;
    var allTabs = await callTabsQuery({});
    var records = await loadKnownRecords();

    records = mergeKnownRecords(records, allTabs);
    if (senderTab) records = mergeKnownRecords(records, [senderTab]);
    await saveKnownRecords(records);

    var windowId = senderTab && Number.isInteger(senderTab.windowId)
      ? senderTab.windowId
      : null;
    var windowIds = {};
    allTabs.forEach(function (tab) {
      if (tab && Number.isInteger(tab.windowId)) windowIds[tab.windowId] = true;
    });

    var context = {
      singleWindow: Object.keys(windowIds).length <= 1
    };
    var recovered = [];

    var tabs = allTabs.filter(function (tab) {
      if (!tab || !Number.isInteger(tab.id)) return false;
      if (windowId !== null && tab.windowId !== windowId) return false;

      var url = getTabUrl(tab);
      if (url) return isChatGPTUrl(url);

      var match = findDormantMatch(tab, records, context);
      if (!match) return false;

      recovered.push({ tabId: tab.id, reason: match.reason });
      return true;
    }).sort(function (left, right) {
      return Number(left.index || 0) - Number(right.index || 0);
    });

    if (tabs.length < 2) {
      return {
        ok: false,
        code: "NOT_ENOUGH_TABS",
        count: tabs.length,
        recoveredCount: recovered.length,
        recoveredTarget: false
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
        count: tabs.length,
        recoveredCount: recovered.length,
        recoveredTarget: false
      };
    }

    await callTabsUpdate(target.id, { active: true });

    return {
      ok: true,
      code: "OK",
      count: tabs.length,
      recoveredCount: recovered.length,
      recoveredTarget: recovered.some(function (item) { return item.tabId === target.id; })
    };
  }

  if (!api || !api.runtime || !api.runtime.onMessage || !api.tabs) return;

  api.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return false;

    var task;
    if (message.type === "room-layer-tab-navigation-ping") {
      if (message.protocol !== PROTOCOL) {
        task = Promise.resolve({ ok: false, code: "INCOMPATIBLE_PROTOCOL" });
      } else {
        task = Promise.resolve(createPingResult());
      }
    } else if (
      message.type === "room-layer-tab-navigation-switch-next" ||
      message.type === "chatgpt-layer-switch-next-tab"
    ) {
      if (
        message.type === "room-layer-tab-navigation-switch-next" &&
        message.protocol !== PROTOCOL
      ) {
        task = Promise.resolve({ ok: false, code: "INCOMPATIBLE_PROTOCOL" });
      } else {
        task = switchToNextChatGPTTab(sender);
      }
    } else if (message.type === "chatgpt-layer-register-tab") {
      task = registerSenderTab(sender);
    } else {
      return false;
    }

    task.then(function (result) {
      sendResponse(result);
    }).catch(function () {
      sendResponse({
        ok: false,
        code: message.type === "chatgpt-layer-register-tab"
          ? "REGISTER_FAILED"
          : "TAB_SWITCH_FAILED"
      });
    });

    return true;
  });

  if (api.tabs.onUpdated && typeof api.tabs.onUpdated.addListener === "function") {
    api.tabs.onUpdated.addListener(function (_tabId, _changeInfo, tab) {
      if (tab && isChatGPTUrl(getTabUrl(tab))) rememberExplicitTabs([tab]);
    });
  }

  setTimeout(function () {
    callTabsQuery({}).then(rememberExplicitTabs).catch(function () {});
  }, 0);
})();
