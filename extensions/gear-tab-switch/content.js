(function () {
  "use strict";

  if (window.top !== window.self) return;

  var api = globalThis.browser || globalThis.chrome;
  if (!api || !api.runtime || typeof api.runtime.sendMessage !== "function") return;

  var PROTOCOL = 1;
  var REQUEST_EVENT = "room-layer:tab-navigation:request";
  var RESPONSE_EVENT = "room-layer:tab-navigation:response";
  var READY_EVENT = "room-layer:tab-navigation:ready";
  var VERSION = api.runtime.getManifest
    ? api.runtime.getManifest().version
    : "unknown";
  var ALLOWED_COMMANDS = {
    PING: "room-layer-tab-navigation-ping",
    SWITCH_NEXT: "room-layer-tab-navigation-switch-next"
  };

  function sendMessage(message) {
    return new Promise(function (resolve, reject) {
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

  function isValidRequest(detail) {
    return Boolean(
      detail &&
      typeof detail === "object" &&
      detail.protocol === PROTOCOL &&
      typeof detail.requestId === "string" &&
      detail.requestId.length > 0 &&
      detail.requestId.length <= 96 &&
      Object.prototype.hasOwnProperty.call(ALLOWED_COMMANDS, detail.command)
    );
  }

  function sanitizeResult(result) {
    result = result && typeof result === "object" ? result : {};
    return {
      protocol: PROTOCOL,
      ok: Boolean(result.ok),
      code: typeof result.code === "string"
        ? result.code
        : result.ok ? "OK" : "TAB_SWITCH_FAILED",
      extensionVersion: VERSION,
      count: Number.isInteger(result.count) ? result.count : null,
      recoveredCount: Number.isInteger(result.recoveredCount) ? result.recoveredCount : 0,
      recoveredTarget: Boolean(result.recoveredTarget)
    };
  }

  function dispatchResponse(requestId, result) {
    var detail = sanitizeResult(result);
    detail.requestId = requestId;
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: detail }));
  }

  function dispatchReady() {
    document.dispatchEvent(new CustomEvent(READY_EVENT, {
      detail: {
        protocol: PROTOCOL,
        extensionVersion: VERSION
      }
    }));
  }

  function registerCurrentTab() {
    sendMessage({
      type: "chatgpt-layer-register-tab",
      version: VERSION
    }).catch(function () {});
  }

  document.addEventListener(REQUEST_EVENT, function (event) {
    var detail = event && event.detail;

    if (!detail || typeof detail !== "object") return;
    if (detail.protocol !== PROTOCOL) {
      if (typeof detail.requestId === "string" && detail.requestId.length <= 96) {
        dispatchResponse(detail.requestId, {
          ok: false,
          code: "INCOMPATIBLE_PROTOCOL"
        });
      }
      return;
    }
    if (!isValidRequest(detail)) return;

    sendMessage({
      type: ALLOWED_COMMANDS[detail.command],
      protocol: PROTOCOL,
      version: VERSION
    }).then(function (result) {
      dispatchResponse(detail.requestId, result);
    }).catch(function () {
      dispatchResponse(detail.requestId, {
        ok: false,
        code: "TAB_SWITCH_FAILED"
      });
    });
  });

  registerCurrentTab();
  dispatchReady();

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    registerCurrentTab();
    dispatchReady();
  });

  window.addEventListener("pageshow", function () {
    registerCurrentTab();
    dispatchReady();
  });
})();
