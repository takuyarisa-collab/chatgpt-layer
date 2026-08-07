// ==UserScript==
// @name         Room Layer Dev
// @name:en      Room Layer Dev
// @name:ja      Room Layer 開発版
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer-product
// @version      0.3.0-dev12.1
// @description  Create a personal room around ChatGPT with scoped appearance and quick actions.
// @description:ja ChatGPTの見た目と操作環境を、チャットやプロジェクトごとの部屋として整えます。
// @author       Shion Works
// @homepage     https://shion-works.itch.io/room-layer
// @homepageURL  https://shion-works.itch.io/room-layer
// @supportURL   https://shion-works.itch.io/room-layer
// @updateURL    https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/channels/dev/room-layer-dev.meta.js
// @downloadURL  https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/channels/dev/room-layer-dev.user.js
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @noframes
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// ==/UserScript==

// ============================================================
// ✅ Room Layerのインストール完了後、ブラウザの「戻る」を1回押してください
// ✅ After installing Room Layer, tap the browser Back button once.
// ============================================================

(function () {
  "use strict";
  const __modules = Object.create(null);
  __modules["src/adapters/gear/storage-backend.js"] = (() => {
    class GearStorageUnavailableError extends Error {
      constructor(message = "Gear UserScript storage APIs are unavailable.") {
        super(message);
        this.name = "GearStorageUnavailableError";
        this.code = "gear_storage_unavailable";
      }
    }
    
    function createGearStorageBackend(options = {}) {
      const scope = options.scope ?? globalThis;
      const api = resolveStorageApi(scope, options);
    
      return Object.freeze({
        async get(key) {
          assertStorageKey(key);
          return await api.getValue(key, null);
        },
    
        async set(key, value) {
          assertStorageKey(key);
          if (typeof value !== "string") {
            throw new TypeError("Gear storage values must be JSON text strings.");
          }
          await api.setValue(key, value);
        },
    
        async remove(key) {
          assertStorageKey(key);
          await api.deleteValue(key);
        },
    
        apiStyle: api.style
      });
    }
    
    function resolveStorageApi(scope, options) {
      const explicit = {
        getValue: options.getValue,
        setValue: options.setValue,
        deleteValue: options.deleteValue
      };
    
      if (hasFunctions(explicit)) {
        return { ...explicit, style: "explicit" };
      }
    
      const legacy = bindApi(
        {
          getValue: scope?.GM_getValue,
          setValue: scope?.GM_setValue,
          deleteValue: scope?.GM_deleteValue
        },
        scope
      );
    
      if (hasFunctions(legacy)) {
        return { ...legacy, style: "legacy" };
      }
    
      const modernOwner = scope?.GM;
      const modern = bindApi(
        {
          getValue: modernOwner?.getValue,
          setValue: modernOwner?.setValue,
          deleteValue: modernOwner?.deleteValue
        },
        modernOwner
      );
    
      if (hasFunctions(modern)) {
        return { ...modern, style: "modern" };
      }
    
      throw new GearStorageUnavailableError();
    }
    
    function bindApi(api, owner) {
      if (!owner) {
        return api;
      }
    
      return {
        getValue: typeof api.getValue === "function" ? api.getValue.bind(owner) : api.getValue,
        setValue: typeof api.setValue === "function" ? api.setValue.bind(owner) : api.setValue,
        deleteValue: typeof api.deleteValue === "function" ? api.deleteValue.bind(owner) : api.deleteValue
      };
    }
    
    function hasFunctions(value) {
      return (
        typeof value.getValue === "function" &&
        typeof value.setValue === "function" &&
        typeof value.deleteValue === "function"
      );
    }
    
    function assertStorageKey(key) {
      if (typeof key !== "string" || key.length === 0 || key.length > 256) {
        throw new TypeError("Storage key must be a non-empty string up to 256 characters.");
      }
    }
    return { GearStorageUnavailableError, createGearStorageBackend };
  })();
  __modules["src/adapters/gear/tab-navigation-bridge.js"] = (() => {
    const TAB_NAVIGATION_PROTOCOL_VERSION = 1;
    const TAB_NAVIGATION_REQUEST_EVENT = "room-layer:tab-navigation:request";
    const TAB_NAVIGATION_RESPONSE_EVENT = "room-layer:tab-navigation:response";
    const TAB_NAVIGATION_READY_EVENT = "room-layer:tab-navigation:ready";
    
    const TAB_NAVIGATION_STATES = Object.freeze([
      "unknown",
      "connected",
      "unavailable",
      "incompatible",
      "error"
    ]);
    
    const COMMANDS = Object.freeze({
      PING: "PING",
      SWITCH_NEXT: "SWITCH_NEXT"
    });
    const DEFAULT_TIMEOUT_MS = 1200;
    const DEFAULT_PING_RETRY_DELAYS_MS = Object.freeze([250, 750, 1500]);
    
    function createGearTabNavigationBridge({
      document,
      window = globalThis,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      pingRetryDelaysMs = DEFAULT_PING_RETRY_DELAYS_MS
    } = {}) {
      if (!document?.addEventListener || !document?.dispatchEvent) {
        throw new TypeError("Tab navigation bridge requires a browser document.");
      }
    
      const CustomEventConstructor = window?.CustomEvent ?? globalThis.CustomEvent;
      if (typeof CustomEventConstructor !== "function") {
        throw new TypeError("Tab navigation bridge requires CustomEvent support.");
      }
    
      const retryDelays = Array.isArray(pingRetryDelaysMs)
        ? pingRetryDelaysMs.map(normalizeDelay)
        : [...DEFAULT_PING_RETRY_DELAYS_MS];
      const pending = new Map();
      const listeners = new Set();
      let state = "unknown";
      let destroyed = false;
      let requestSequence = 0;
    
      const handleReady = (event) => {
        if (destroyed) return;
        const detail = readBridgeDetail(event?.detail);
        if (!detail) return;
        if (detail.protocol !== TAB_NAVIGATION_PROTOCOL_VERSION) {
          setState("incompatible");
          return;
        }
        setState("connected");
      };
    
      const handleResponse = (event) => {
        if (destroyed) return;
        const detail = readBridgeDetail(event?.detail);
        if (!detail || typeof detail.requestId !== "string") return;
        const entry = pending.get(detail.requestId);
        if (!entry) return;
    
        pending.delete(detail.requestId);
        window.clearTimeout?.(entry.timer);
    
        if (detail.protocol !== TAB_NAVIGATION_PROTOCOL_VERSION) {
          setState("incompatible");
          entry.resolve(createFailure("INCOMPATIBLE_PROTOCOL"));
          return;
        }
    
        if (detail.code === "INCOMPATIBLE_PROTOCOL") setState("incompatible");
        else setState("connected");
    
        entry.resolve(sanitizeResponse(detail));
      };
    
      document.addEventListener(TAB_NAVIGATION_READY_EVENT, handleReady);
      document.addEventListener(TAB_NAVIGATION_RESPONSE_EVENT, handleResponse);
    
      function getState() {
        return state;
      }
    
      function subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        listener(state);
        return () => listeners.delete(listener);
      }
    
      async function ping() {
        let result = null;
    
        for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
          if (state === "connected") return result?.ok ? result : createSuccess();
          if (state === "incompatible" || destroyed) {
            return result ?? createFailure(destroyed ? "BRIDGE_DESTROYED" : "INCOMPATIBLE_PROTOCOL");
          }
    
          result = await request(COMMANDS.PING);
          if (result.ok) return result;
          if (state === "connected") return createSuccess();
          if (state === "incompatible" || destroyed) return result;
    
          if (result.code === "BRIDGE_TIMEOUT") setState("unavailable");
          if (attempt >= retryDelays.length) return result;
          await wait(retryDelays[attempt]);
        }
    
        return result ?? createFailure("BRIDGE_TIMEOUT");
      }
    
      async function switchNext() {
        if (state !== "connected") {
          const connection = await ping();
          if (!connection.ok) return connection;
        }
        return request(COMMANDS.SWITCH_NEXT);
      }
    
      function request(command) {
        if (destroyed) return Promise.resolve(createFailure("BRIDGE_DESTROYED"));
        if (!Object.values(COMMANDS).includes(command)) {
          return Promise.resolve(createFailure("UNSUPPORTED_COMMAND"));
        }
    
        const requestId = createRequestId();
        return new Promise((resolve) => {
          const timer = window.setTimeout?.(() => {
            if (!pending.has(requestId)) return;
            pending.delete(requestId);
            if (command === COMMANDS.PING) setState("unavailable");
            else setState("error");
            resolve(createFailure("BRIDGE_TIMEOUT"));
          }, timeoutMs);
    
          pending.set(requestId, { resolve, timer });
    
          try {
            document.dispatchEvent(new CustomEventConstructor(TAB_NAVIGATION_REQUEST_EVENT, {
              detail: Object.freeze({
                protocol: TAB_NAVIGATION_PROTOCOL_VERSION,
                requestId,
                command
              })
            }));
          } catch {
            pending.delete(requestId);
            window.clearTimeout?.(timer);
            setState("error");
            resolve(createFailure("BRIDGE_DISPATCH_FAILED"));
          }
        });
      }
    
      function wait(delayMs) {
        return new Promise((resolve) => window.setTimeout?.(resolve, delayMs));
      }
    
      function destroy() {
        if (destroyed) return;
        destroyed = true;
        document.removeEventListener(TAB_NAVIGATION_READY_EVENT, handleReady);
        document.removeEventListener(TAB_NAVIGATION_RESPONSE_EVENT, handleResponse);
        for (const entry of pending.values()) {
          window.clearTimeout?.(entry.timer);
          entry.resolve(createFailure("BRIDGE_DESTROYED"));
        }
        pending.clear();
        listeners.clear();
      }
    
      function setState(nextState) {
        if (!TAB_NAVIGATION_STATES.includes(nextState) || state === nextState) return;
        state = nextState;
        for (const listener of listeners) {
          try {
            listener(state);
          } catch {
            // State observers must not break navigation.
          }
        }
      }
    
      function createRequestId() {
        requestSequence += 1;
        return `rl-tab-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
      }
    
      return Object.freeze({
        getState,
        subscribe,
        ping,
        switchNext,
        destroy
      });
    }
    
    function readBridgeDetail(detail) {
      if (!detail || typeof detail !== "object") return null;
      if (!Number.isInteger(detail.protocol)) return null;
      return detail;
    }
    
    function sanitizeResponse(detail) {
      return Object.freeze({
        ok: Boolean(detail.ok),
        code: typeof detail.code === "string" ? detail.code : detail.ok ? "OK" : "UNKNOWN_ERROR",
        protocol: detail.protocol,
        extensionVersion: typeof detail.extensionVersion === "string" ? detail.extensionVersion : null,
        count: Number.isInteger(detail.count) ? detail.count : null,
        recoveredCount: Number.isInteger(detail.recoveredCount) ? detail.recoveredCount : 0,
        recoveredTarget: Boolean(detail.recoveredTarget)
      });
    }
    
    function createSuccess() {
      return Object.freeze({
        ok: true,
        code: "OK",
        protocol: TAB_NAVIGATION_PROTOCOL_VERSION,
        extensionVersion: null,
        count: null,
        recoveredCount: 0,
        recoveredTarget: false
      });
    }
    
    function createFailure(code) {
      return Object.freeze({
        ok: false,
        code,
        protocol: TAB_NAVIGATION_PROTOCOL_VERSION,
        extensionVersion: null,
        count: null,
        recoveredCount: 0,
        recoveredTarget: false
      });
    }
    
    function normalizeDelay(value) {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : 0;
    }
    return { TAB_NAVIGATION_PROTOCOL_VERSION, TAB_NAVIGATION_REQUEST_EVENT, TAB_NAVIGATION_RESPONSE_EVENT, TAB_NAVIGATION_READY_EVENT, TAB_NAVIGATION_STATES, createGearTabNavigationBridge };
  })();
  __modules["src/core/chatgpt-context.js"] = (() => {
    const SUPPORTED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
    const PROJECT_ID_PATTERN = /^\/g\/(g-p-[a-z0-9]{16,64})(?:-[^/]+)?(?:\/|$)/i;
    const CHAT_ID_PATTERN = /\/c\/([a-z0-9-]{8,128})(?:\/|$)/i;
    
    function parseChatGptContext(input = globalThis.location) {
      const url = toUrl(input);
      const host = url.hostname.toLowerCase();
      const supported = SUPPORTED_HOSTS.has(host);
    
      if (!supported) {
        return Object.freeze({
          supported: false,
          host,
          projectId: null,
          chatId: null,
          contextKey: "unsupported"
        });
      }
    
      const projectId = matchFirst(url.pathname, PROJECT_ID_PATTERN);
      const chatId = matchFirst(url.pathname, CHAT_ID_PATTERN);
    
      return Object.freeze({
        supported: true,
        host,
        projectId,
        chatId,
        contextKey: buildContextKey(projectId, chatId)
      });
    }
    
    function resolveAssignedLayerIds(assignments, context) {
      assertAssignments(assignments);
      assertContext(context);
    
      const result = [];
      const seen = new Set();
    
      appendUnique(result, seen, assignments.global);
    
      if (context.projectId) {
        appendUnique(result, seen, assignments.projects[context.projectId] ?? []);
      }
    
      if (context.chatId) {
        appendUnique(result, seen, assignments.chats[context.chatId] ?? []);
      }
    
      return Object.freeze(result);
    }
    
    function getAvailableAssignmentScopes(context) {
      assertContext(context);
    
      const scopes = ["global"];
      if (context.projectId) {
        scopes.push("project");
      }
      if (context.chatId) {
        scopes.push("chat");
      }
      return Object.freeze(scopes);
    }
    
    function toUrl(input) {
      if (input instanceof URL) {
        return input;
      }
    
      if (typeof input === "string") {
        return new URL(input, "https://chatgpt.com");
      }
    
      if (input && typeof input.href === "string") {
        return new URL(input.href);
      }
    
      if (input && typeof input.pathname === "string") {
        const host = typeof input.hostname === "string" ? input.hostname : "chatgpt.com";
        const protocol = typeof input.protocol === "string" ? input.protocol : "https:";
        return new URL(`${protocol}//${host}${input.pathname}`);
      }
    
      throw new TypeError("ChatGPT context input must be a URL, URL string, or location-like object.");
    }
    
    function matchFirst(value, pattern) {
      const match = value.match(pattern);
      return match ? match[1] : null;
    }
    
    function buildContextKey(projectId, chatId) {
      if (projectId && chatId) {
        return `project:${projectId}|chat:${chatId}`;
      }
      if (chatId) {
        return `chat:${chatId}`;
      }
      if (projectId) {
        return `project:${projectId}`;
      }
      return "global";
    }
    
    function appendUnique(target, seen, values) {
      for (const value of values) {
        if (!seen.has(value)) {
          seen.add(value);
          target.push(value);
        }
      }
    }
    
    function assertAssignments(assignments) {
      if (
        !assignments ||
        !Array.isArray(assignments.global) ||
        !isRecord(assignments.projects) ||
        !isRecord(assignments.chats)
      ) {
        throw new TypeError("Assignments must contain global, projects, and chats collections.");
      }
    }
    
    function assertContext(context) {
      if (!context || typeof context !== "object" || typeof context.supported !== "boolean") {
        throw new TypeError("Context must be produced by parseChatGptContext.");
      }
    }
    
    function isRecord(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }
    return { parseChatGptContext, resolveAssignedLayerIds, getAvailableAssignmentScopes };
  })();
  __modules["src/core/runtime-guard.js"] = (() => {
    const PRODUCT_UI_HOST_ID = "chatgpt-layer-product-ui";
    const PRODUCT_RUNTIME_ATTRIBUTE = "data-chatgpt-layer-product-runtime";
    
    function claimProductRuntime({
      document,
      token = createRuntimeToken()
    }) {
      if (!document?.documentElement) {
        throw new TypeError("Product runtime guard requires a browser document.");
      }
    
      const runtimeToken = String(token);
      document.documentElement.setAttribute(PRODUCT_RUNTIME_ATTRIBUTE, runtimeToken);
      removeCompetingUiHosts(document, null);
    
      let observer = null;
      let activeHost = null;
    
      function isCurrent() {
        return document.documentElement.getAttribute(PRODUCT_RUNTIME_ATTRIBUTE) === runtimeToken;
      }
    
      function watchUiHost(host, MutationObserver = globalThis.MutationObserver) {
        if (!host || host.id !== PRODUCT_UI_HOST_ID) {
          throw new TypeError("Runtime guard requires the active product UI host.");
        }
    
        stopWatching();
        activeHost = host;
        removeCompetingUiHosts(document, activeHost);
    
        if (typeof MutationObserver !== "function" || !document.body) {
          return;
        }
    
        observer = new MutationObserver(() => {
          if (isCurrent()) {
            removeCompetingUiHosts(document, activeHost);
          }
        });
        observer.observe(document.body, { childList: true, subtree: false });
      }
    
      function stopWatching() {
        observer?.disconnect();
        observer = null;
      }
    
      function release() {
        stopWatching();
        if (isCurrent()) {
          document.documentElement.removeAttribute(PRODUCT_RUNTIME_ATTRIBUTE);
        }
        activeHost = null;
      }
    
      return Object.freeze({
        token: runtimeToken,
        isCurrent,
        watchUiHost,
        release
      });
    }
    
    function removeCompetingUiHosts(document, activeHost = null) {
      const hosts = getUiHosts(document);
      for (const host of hosts) {
        if (host !== activeHost) {
          host.remove?.();
        }
      }
      return hosts.length;
    }
    
    function getUiHosts(document) {
      if (typeof document?.querySelectorAll === "function") {
        return [...document.querySelectorAll(`#${PRODUCT_UI_HOST_ID}`)];
      }
    
      const host = document?.getElementById?.(PRODUCT_UI_HOST_ID);
      return host ? [host] : [];
    }
    
    function createRuntimeToken() {
      const random = globalThis.crypto?.randomUUID?.();
      if (random) return random;
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
    return { PRODUCT_UI_HOST_ID, PRODUCT_RUNTIME_ATTRIBUTE, claimProductRuntime, removeCompetingUiHosts };
  })();
  __modules["src/core/schema-v1.js"] = (() => {
    const SETTINGS_FORMAT = "chatgpt-layer-settings";
    const SCHEMA_VERSION = 1;
    const SUPPORTED_LANGUAGES = Object.freeze(["auto", "en", "ja"]);
    const COMPOSER_APPEARANCES = Object.freeze(["solid", "wood"]);
    const DEFAULT_COMPOSER_APPEARANCE = "solid";
    
    const SCHEMA_LIMITS = Object.freeze({
      layers: 100,
      projectAssignments: 500,
      chatAssignments: 2000,
      layersPerAssignment: 16,
      layerNameLength: 64,
      contextIdLength: 256
    });
    
    const LAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
    const HEX_COLOR_PATTERN = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
    
    class SettingsValidationError extends Error {
      constructor(errors) {
        super("Settings validation failed");
        this.name = "SettingsValidationError";
        this.errors = errors;
      }
    }
    
    function createDefaultSettings() {
      return {
        format: SETTINGS_FORMAT,
        schemaVersion: SCHEMA_VERSION,
        language: "auto",
        assignments: {
          global: [],
          projects: {},
          chats: {}
        },
        layers: {}
      };
    }
    
    function validateSettings(value) {
      const errors = [];
    
      if (!isPlainObject(value)) {
        addError(errors, "$", "invalid_type", "Settings must be a plain object.");
        return { valid: false, errors };
      }
    
      rejectUnknownKeys(value, ["format", "schemaVersion", "language", "assignments", "layers"], "$", errors);
    
      if (value.format !== SETTINGS_FORMAT) {
        addError(errors, "$.format", "invalid_format", `Expected ${SETTINGS_FORMAT}.`);
      }
    
      if (value.schemaVersion !== SCHEMA_VERSION) {
        addError(errors, "$.schemaVersion", "unsupported_schema", `Expected schema version ${SCHEMA_VERSION}.`);
      }
    
      if (!SUPPORTED_LANGUAGES.includes(value.language)) {
        addError(errors, "$.language", "unsupported_language", "Language must be auto, en, or ja.");
      }
    
      validateAssignments(value.assignments, errors);
      validateLayers(value.layers, errors);
    
      if (isPlainObject(value.assignments) && isPlainObject(value.layers)) {
        validateAssignmentReferences(value.assignments, value.layers, errors);
      }
    
      return { valid: errors.length === 0, errors };
    }
    
    function normalizeSettings(value) {
      const result = validateSettings(value);
      if (!result.valid) {
        throw new SettingsValidationError(result.errors);
      }
    
      const projects = {};
      for (const [contextId, layerIds] of Object.entries(value.assignments.projects)) {
        projects[contextId] = [...layerIds];
      }
    
      const chats = {};
      for (const [contextId, layerIds] of Object.entries(value.assignments.chats)) {
        chats[contextId] = [...layerIds];
      }
    
      const layers = {};
      for (const [layerId, layer] of Object.entries(value.layers)) {
        layers[layerId] = {
          name: layer.name,
          enabled: layer.enabled,
          theme: normalizeTheme(layer.theme)
        };
      }
    
      return {
        format: SETTINGS_FORMAT,
        schemaVersion: SCHEMA_VERSION,
        language: value.language,
        assignments: {
          global: [...value.assignments.global],
          projects,
          chats
        },
        layers
      };
    }
    
    function normalizeTheme(theme) {
      const normalized = {};
      if (isPlainObject(theme.page)) {
        normalized.page = { background: theme.page.background };
      }
      if (isPlainObject(theme.composer)) {
        normalized.composer = {
          background: theme.composer.background,
          appearance: theme.composer.appearance ?? DEFAULT_COMPOSER_APPEARANCE
        };
      }
      return normalized;
    }
    
    function validateAssignments(assignments, errors) {
      if (!isPlainObject(assignments)) {
        addError(errors, "$.assignments", "invalid_type", "Assignments must be a plain object.");
        return;
      }
    
      rejectUnknownKeys(assignments, ["global", "projects", "chats"], "$.assignments", errors);
      validateLayerIdArray(assignments.global, "$.assignments.global", errors);
      validateAssignmentMap(assignments.projects, "$.assignments.projects", SCHEMA_LIMITS.projectAssignments, errors);
      validateAssignmentMap(assignments.chats, "$.assignments.chats", SCHEMA_LIMITS.chatAssignments, errors);
    }
    
    function validateAssignmentMap(value, path, maxEntries, errors) {
      if (!isPlainObject(value)) {
        addError(errors, path, "invalid_type", "Assignment map must be a plain object.");
        return;
      }
    
      const entries = Object.entries(value);
      if (entries.length > maxEntries) {
        addError(errors, path, "limit_exceeded", `Assignment map exceeds ${maxEntries} entries.`);
      }
    
      for (const [contextId, layerIds] of entries) {
        if (contextId.length === 0 || contextId.length > SCHEMA_LIMITS.contextIdLength) {
          addError(errors, `${path}.${contextId}`, "invalid_context_id", `Context ID must be 1-${SCHEMA_LIMITS.contextIdLength} characters.`);
        }
        validateLayerIdArray(layerIds, `${path}.${contextId}`, errors);
      }
    }
    
    function validateLayerIdArray(value, path, errors) {
      if (!Array.isArray(value)) {
        addError(errors, path, "invalid_type", "Layer assignment must be an array.");
        return;
      }
    
      if (value.length > SCHEMA_LIMITS.layersPerAssignment) {
        addError(errors, path, "limit_exceeded", `Assignment exceeds ${SCHEMA_LIMITS.layersPerAssignment} layers.`);
      }
    
      const seen = new Set();
      value.forEach((layerId, index) => {
        const itemPath = `${path}[${index}]`;
        if (typeof layerId !== "string" || !LAYER_ID_PATTERN.test(layerId)) {
          addError(errors, itemPath, "invalid_layer_id", "Layer ID contains unsupported characters or length.");
          return;
        }
        if (seen.has(layerId)) {
          addError(errors, itemPath, "duplicate_layer_id", "Layer assignment contains a duplicate layer ID.");
          return;
        }
        seen.add(layerId);
      });
    }
    
    function validateLayers(layers, errors) {
      if (!isPlainObject(layers)) {
        addError(errors, "$.layers", "invalid_type", "Layers must be a plain object.");
        return;
      }
    
      const entries = Object.entries(layers);
      if (entries.length > SCHEMA_LIMITS.layers) {
        addError(errors, "$.layers", "limit_exceeded", `Layers exceed ${SCHEMA_LIMITS.layers}.`);
      }
    
      for (const [layerId, layer] of entries) {
        const path = `$.layers.${layerId}`;
        if (!LAYER_ID_PATTERN.test(layerId)) {
          addError(errors, path, "invalid_layer_id", "Layer ID contains unsupported characters or length.");
        }
        validateLayer(layer, path, errors);
      }
    }
    
    function validateLayer(layer, path, errors) {
      if (!isPlainObject(layer)) {
        addError(errors, path, "invalid_type", "Layer must be a plain object.");
        return;
      }
    
      rejectUnknownKeys(layer, ["name", "enabled", "theme"], path, errors);
    
      if (typeof layer.name !== "string" || layer.name.length === 0 || layer.name.length > SCHEMA_LIMITS.layerNameLength) {
        addError(errors, `${path}.name`, "invalid_layer_name", `Layer name must be 1-${SCHEMA_LIMITS.layerNameLength} characters.`);
      }
    
      if (typeof layer.enabled !== "boolean") {
        addError(errors, `${path}.enabled`, "invalid_type", "Layer enabled must be boolean.");
      }
    
      validateTheme(layer.theme, `${path}.theme`, errors);
    }
    
    function validateTheme(theme, path, errors) {
      if (!isPlainObject(theme)) {
        addError(errors, path, "invalid_type", "Theme must be a plain object.");
        return;
      }
    
      rejectUnknownKeys(theme, ["page", "composer"], path, errors);
    
      const hasPage = Object.prototype.hasOwnProperty.call(theme, "page");
      const hasComposer = Object.prototype.hasOwnProperty.call(theme, "composer");
      if (!hasPage && !hasComposer) {
        addError(errors, path, "empty_theme", "Theme must configure at least one supported surface.");
        return;
      }
    
      if (hasPage) {
        validatePageTheme(theme.page, `${path}.page`, errors);
      }
      if (hasComposer) {
        validateComposerTheme(theme.composer, `${path}.composer`, errors);
      }
    }
    
    function validatePageTheme(surface, path, errors) {
      if (!isPlainObject(surface)) {
        addError(errors, path, "invalid_type", "Page theme must be a plain object.");
        return;
      }
    
      rejectUnknownKeys(surface, ["background"], path, errors);
      validateBackground(surface.background, `${path}.background`, errors);
    }
    
    function validateComposerTheme(surface, path, errors) {
      if (!isPlainObject(surface)) {
        addError(errors, path, "invalid_type", "Composer theme must be a plain object.");
        return;
      }
    
      rejectUnknownKeys(surface, ["background", "appearance"], path, errors);
      validateBackground(surface.background, `${path}.background`, errors);
    
      if (
        Object.prototype.hasOwnProperty.call(surface, "appearance") &&
        !COMPOSER_APPEARANCES.includes(surface.appearance)
      ) {
        addError(
          errors,
          `${path}.appearance`,
          "invalid_composer_appearance",
          `Composer appearance must be one of: ${COMPOSER_APPEARANCES.join(", ")}.`
        );
      }
    }
    
    function validateBackground(background, path, errors) {
      if (typeof background !== "string" || !HEX_COLOR_PATTERN.test(background)) {
        addError(errors, path, "invalid_color", "Background must be #RGB, #RRGGBB, or #RRGGBBAA.");
      }
    }
    
    function validateAssignmentReferences(assignments, layers, errors) {
      const knownLayers = new Set(Object.keys(layers));
    
      validateReferenceArray(assignments.global, "$.assignments.global", knownLayers, errors);
    
      if (isPlainObject(assignments.projects)) {
        for (const [contextId, layerIds] of Object.entries(assignments.projects)) {
          validateReferenceArray(layerIds, `$.assignments.projects.${contextId}`, knownLayers, errors);
        }
      }
    
      if (isPlainObject(assignments.chats)) {
        for (const [contextId, layerIds] of Object.entries(assignments.chats)) {
          validateReferenceArray(layerIds, `$.assignments.chats.${contextId}`, knownLayers, errors);
        }
      }
    }
    
    function validateReferenceArray(layerIds, path, knownLayers, errors) {
      if (!Array.isArray(layerIds)) {
        return;
      }
    
      layerIds.forEach((layerId, index) => {
        if (typeof layerId === "string" && LAYER_ID_PATTERN.test(layerId) && !knownLayers.has(layerId)) {
          addError(errors, `${path}[${index}]`, "missing_layer", `Referenced layer ${layerId} does not exist.`);
        }
      });
    }
    
    function rejectUnknownKeys(value, allowedKeys, path, errors) {
      if (!isPlainObject(value)) {
        return;
      }
    
      const allowed = new Set(allowedKeys);
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          addError(errors, `${path}.${key}`, "unknown_field", `Unsupported field ${key}.`);
        }
      }
    }
    
    function isPlainObject(value) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
      }
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    }
    
    function addError(errors, path, code, message) {
      errors.push({ path, code, message });
    }
    return { SETTINGS_FORMAT, SCHEMA_VERSION, SUPPORTED_LANGUAGES, COMPOSER_APPEARANCES, DEFAULT_COMPOSER_APPEARANCE, SCHEMA_LIMITS, SettingsValidationError, createDefaultSettings, validateSettings, normalizeSettings };
  })();
  __modules["src/core/settings-editor.js"] = (() => {
    const { DEFAULT_COMPOSER_APPEARANCE, normalizeSettings } = __modules["src/core/schema-v1.js"];
    const { resolveAssignedLayerIds } = __modules["src/core/chatgpt-context.js"];
    
    const MANAGED_LAYER_PREFIX = "custom";
    const DEFAULT_PAGE_BACKGROUND = "#171717";
    const DEFAULT_COMPOSER_BACKGROUND = "#303030";
    
    class SettingsEditError extends Error {
      constructor(code, message) {
        super(message);
        this.name = "SettingsEditError";
        this.code = code;
      }
    }
    
    function upsertPageBackground(settings, options) {
      return upsertSurfaceBackground(settings, "page", options);
    }
    
    function upsertComposerBackground(settings, options) {
      return upsertComposerTheme(settings, options);
    }
    
    function upsertComposerTheme(settings, options) {
      const { scope, context, color, appearance, layerName } = options;
      const normalized = normalizeSettings(settings);
      const target = resolveAssignmentTarget(scope, context);
      const layerId = buildManagedLayerId(scope, target.contextId);
      const next = clone(normalized);
      const existingLayer = next.layers[layerId];
      const theme = { ...(existingLayer?.theme ?? {}) };
      const existingComposer = theme.composer ?? {};
    
      theme.composer = {
        background: color ?? existingComposer.background ?? DEFAULT_COMPOSER_BACKGROUND,
        appearance: appearance ?? existingComposer.appearance ?? DEFAULT_COMPOSER_APPEARANCE
      };
    
      next.layers[layerId] = {
        name: normalizeLayerName(layerName ?? existingLayer?.name, scope),
        enabled: true,
        theme
      };
    
      assignManagedLayer(next, target, layerId);
      return normalizeSettings(next);
    }
    
    function getEffectivePageBackground(settings, context, fallback = DEFAULT_PAGE_BACKGROUND) {
      return getEffectiveSurfaceValue(settings, context, "page", "background", fallback);
    }
    
    function getEffectiveComposerBackground(settings, context, fallback = DEFAULT_COMPOSER_BACKGROUND) {
      return getEffectiveSurfaceValue(settings, context, "composer", "background", fallback);
    }
    
    function getEffectiveComposerAppearance(
      settings,
      context,
      fallback = DEFAULT_COMPOSER_APPEARANCE
    ) {
      return getEffectiveSurfaceValue(settings, context, "composer", "appearance", fallback);
    }
    
    function getPreferredScope(context) {
      if (context.chatId) return "chat";
      if (context.projectId) return "project";
      return "global";
    }
    
    function buildManagedLayerId(scope, contextId = null) {
      if (scope === "global") return `${MANAGED_LAYER_PREFIX}-global`;
      if (scope !== "project" && scope !== "chat") {
        throw new SettingsEditError("invalid_scope", `Unsupported assignment scope: ${scope}`);
      }
      if (typeof contextId !== "string" || contextId.length === 0) {
        throw new SettingsEditError("missing_context", `${scope} scope requires a context ID.`);
      }
      return `${MANAGED_LAYER_PREFIX}-${scope}-${hashString(contextId)}`;
    }
    
    function upsertSurfaceBackground(settings, surface, options) {
      const { scope, context, color, layerName } = options;
      const normalized = normalizeSettings(settings);
      const target = resolveAssignmentTarget(scope, context);
      const layerId = buildManagedLayerId(scope, target.contextId);
      const next = clone(normalized);
      const existingLayer = next.layers[layerId];
      const theme = { ...(existingLayer?.theme ?? {}) };
    
      if (surface === "page") {
        theme.page = { background: color };
      } else {
        const existingComposer = theme.composer ?? {};
        theme.composer = {
          background: color,
          appearance: existingComposer.appearance ?? DEFAULT_COMPOSER_APPEARANCE
        };
      }
    
      next.layers[layerId] = {
        name: normalizeLayerName(layerName ?? existingLayer?.name, scope),
        enabled: true,
        theme
      };
    
      assignManagedLayer(next, target, layerId);
      return normalizeSettings(next);
    }
    
    function getEffectiveSurfaceValue(settings, context, surface, property, fallback) {
      const normalized = normalizeSettings(settings);
      const layerIds = resolveAssignedLayerIds(normalized.assignments, context);
      let value = fallback;
    
      for (const layerId of layerIds) {
        const layer = normalized.layers[layerId];
        const candidate = layer?.theme?.[surface]?.[property];
        if (layer?.enabled && candidate !== undefined && candidate !== null) {
          value = candidate;
        }
      }
    
      return value;
    }
    
    function assignManagedLayer(settings, target, layerId) {
      const assignment = getAssignmentArray(settings.assignments, target);
      const withoutManagedLayer = assignment.filter((id) => id !== layerId);
      withoutManagedLayer.push(layerId);
      setAssignmentArray(settings.assignments, target, withoutManagedLayer);
    }
    
    function resolveAssignmentTarget(scope, context) {
      if (scope === "global") return { scope, contextId: null };
      if (scope === "project") {
        if (!context.projectId) {
          throw new SettingsEditError("missing_project", "Project scope requires a project context.");
        }
        return { scope, contextId: context.projectId };
      }
      if (scope === "chat") {
        if (!context.chatId) {
          throw new SettingsEditError("missing_chat", "Chat scope requires a chat context.");
        }
        return { scope, contextId: context.chatId };
      }
      throw new SettingsEditError("invalid_scope", `Unsupported assignment scope: ${scope}`);
    }
    
    function getAssignmentArray(assignments, target) {
      if (target.scope === "global") return assignments.global;
      return assignments[`${target.scope}s`][target.contextId] ?? [];
    }
    
    function setAssignmentArray(assignments, target, value) {
      if (target.scope === "global") {
        assignments.global = value;
        return;
      }
      assignments[`${target.scope}s`][target.contextId] = value;
    }
    
    function normalizeLayerName(layerName, scope) {
      if (typeof layerName === "string") {
        const trimmed = layerName.trim();
        if (trimmed.length > 0 && trimmed.length <= 64) return trimmed;
      }
      if (scope === "global") return "All chats";
      if (scope === "project") return "Project";
      return "Chat";
    }
    
    function hashString(value) {
      let hash = 0x811c9dc5;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    }
    
    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }
    return { SettingsEditError, upsertPageBackground, upsertComposerBackground, upsertComposerTheme, getEffectivePageBackground, getEffectiveComposerBackground, getEffectiveComposerAppearance, getPreferredScope, buildManagedLayerId };
  })();
  __modules["src/features/wood-desk.js"] = (() => {
    const WOOD_DESK_SURFACE_ATTRIBUTE =
      "data-chatgpt-layer-product-desk-surface";
    const WOOD_DESK_MAT_ATTRIBUTE =
      "data-chatgpt-layer-product-desk-mat";
    const WOOD_DESK_SLOT_ATTRIBUTE =
      "data-chatgpt-layer-product-composer-slot";
    
    const INLINE_PROPERTIES = Object.freeze([
      "width",
      "max-width",
      "min-width",
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "box-sizing"
    ]);
    
    function createWoodDeskController({ document }) {
      if (!document || typeof document.createElement !== "function") {
        throw new TypeError("Wood Desk requires a browser document.");
      }
    
      const originalStyles = new WeakMap();
      const knownSurfaces = new Set();
    
      function apply(composer) {
        if (!composer || !composer.parentNode) return null;
    
        const existingMat = composer.parentElement;
        const existingSurface = existingMat?.parentElement;
        const validExisting = Boolean(
          existingMat?.getAttribute?.(WOOD_DESK_MAT_ATTRIBUTE) === "on" &&
          existingSurface?.getAttribute?.(WOOD_DESK_SURFACE_ATTRIBUTE) === "on"
        );
    
        // If ChatGPT replaced the active Composer while the old wrapper is still
        // connected, put the old Composer back before moving to the new one.
        clearDeskStructures(true, validExisting ? composer : null);
    
        if (validExisting) {
          knownSurfaces.add(existingSurface);
          rememberInlineStyles(composer);
          ensureComposerSlot(composer);
          return {
            surface: existingSurface,
            mat: existingMat,
            composer
          };
        }
    
        const parent = composer.parentNode;
        const surface = document.createElement("div");
        const mat = document.createElement("div");
        surface.setAttribute(WOOD_DESK_SURFACE_ATTRIBUTE, "on");
        mat.setAttribute(WOOD_DESK_MAT_ATTRIBUTE, "on");
    
        rememberInlineStyles(composer);
        parent.insertBefore(surface, composer);
        appendNode(surface, mat);
        appendNode(mat, composer);
        ensureComposerSlot(composer);
        knownSurfaces.add(surface);
    
        return { surface, mat, composer };
      }
    
      function clear() {
        clearDeskStructures(true, null);
      }
    
      function destroy() {
        clear();
      }
    
      function clearDeskStructures(restoreComposer, keepComposer) {
        const surfaces = new Set(knownSurfaces);
        if (typeof document.querySelectorAll === "function") {
          for (const surface of document.querySelectorAll(`[${WOOD_DESK_SURFACE_ATTRIBUTE}]`)) {
            surfaces.add(surface);
          }
        }
    
        for (const surface of surfaces) {
          const composer = findComposerInSurface(surface);
          if (keepComposer && composer === keepComposer) continue;
          removeDeskStructure(surface, restoreComposer && !keepComposer);
        }
    
        if (!keepComposer && typeof document.querySelectorAll === "function") {
          for (const composer of document.querySelectorAll(`[${WOOD_DESK_SLOT_ATTRIBUTE}]`)) {
            restoreInlineStyles(composer);
            composer.removeAttribute?.(WOOD_DESK_SLOT_ATTRIBUTE);
          }
        }
      }
    
      function removeDeskStructure(surface, restoreComposer) {
        if (!surface) return;
        const composer = findComposerInSurface(surface);
        const mat = composer?.parentElement;
    
        if (composer) {
          restoreInlineStyles(composer);
          composer.removeAttribute?.(WOOD_DESK_SLOT_ATTRIBUTE);
          if (
            restoreComposer &&
            surface.parentNode &&
            mat &&
            composer.parentNode === mat
          ) {
            surface.parentNode.insertBefore(composer, surface);
          }
        }
    
        surface.remove?.();
        knownSurfaces.delete(surface);
      }
    
      function findComposerInSurface(surface) {
        if (typeof surface?.querySelector === "function") {
          const composer = surface.querySelector(`[${WOOD_DESK_SLOT_ATTRIBUTE}="on"]`);
          if (composer) return composer;
        }
        return findDescendantByAttribute(surface, WOOD_DESK_SLOT_ATTRIBUTE, "on");
      }
    
      function rememberInlineStyles(composer) {
        if (originalStyles.has(composer)) return;
        const snapshot = {};
        for (const property of INLINE_PROPERTIES) {
          snapshot[property] = {
            value: composer.style?.getPropertyValue?.(property) ?? "",
            priority: composer.style?.getPropertyPriority?.(property) ?? ""
          };
        }
        originalStyles.set(composer, snapshot);
      }
    
      function restoreInlineStyles(composer) {
        const snapshot = originalStyles.get(composer);
        if (!snapshot) return;
    
        for (const property of INLINE_PROPERTIES) {
          const entry = snapshot[property];
          if (entry.value) {
            composer.style?.setProperty?.(
              property,
              entry.value,
              entry.priority || ""
            );
          } else {
            composer.style?.removeProperty?.(property);
          }
        }
        originalStyles.delete(composer);
      }
    
      return Object.freeze({ apply, clear, destroy });
    }
    
    function isWoodDeskElement(element) {
      return Boolean(
        element?.hasAttribute?.(WOOD_DESK_SURFACE_ATTRIBUTE) ||
        element?.hasAttribute?.(WOOD_DESK_MAT_ATTRIBUTE)
      );
    }
    
    function ensureComposerSlot(composer) {
      composer.setAttribute?.(WOOD_DESK_SLOT_ATTRIBUTE, "on");
      setImportantStyle(composer, "width", "100%");
      setImportantStyle(composer, "max-width", "100%");
      setImportantStyle(composer, "min-width", "0");
      setImportantStyle(composer, "margin-top", "0");
      setImportantStyle(composer, "margin-right", "0");
      setImportantStyle(composer, "margin-bottom", "0");
      setImportantStyle(composer, "margin-left", "0");
      setImportantStyle(composer, "box-sizing", "border-box");
    }
    
    function setImportantStyle(element, property, value) {
      const style = element?.style;
      if (!style?.setProperty) return;
      if (
        style.getPropertyValue?.(property) === value &&
        style.getPropertyPriority?.(property) === "important"
      ) {
        return;
      }
      style.setProperty(property, value, "important");
    }
    
    function appendNode(parent, child) {
      if (typeof parent?.appendChild === "function") {
        parent.appendChild(child);
        return;
      }
      parent?.append?.(child);
    }
    
    function findDescendantByAttribute(root, attribute, value) {
      const children = Array.isArray(root?.children) ? root.children : Array.from(root?.children ?? []);
      for (const child of children) {
        if (child?.getAttribute?.(attribute) === value) return child;
        const nested = findDescendantByAttribute(child, attribute, value);
        if (nested) return nested;
      }
      return null;
    }
    return { WOOD_DESK_SURFACE_ATTRIBUTE, WOOD_DESK_MAT_ATTRIBUTE, WOOD_DESK_SLOT_ATTRIBUTE, createWoodDeskController, isWoodDeskElement };
  })();
  __modules["src/features/composer-background.js"] = (() => {
    const { WOOD_DESK_MAT_ATTRIBUTE, WOOD_DESK_SLOT_ATTRIBUTE, WOOD_DESK_SURFACE_ATTRIBUTE, createWoodDeskController, isWoodDeskElement } = __modules["src/features/wood-desk.js"];
    
    const ROOT_ATTRIBUTE = "data-chatgpt-layer-product-composer-theme";
    const APPEARANCE_ATTRIBUTE = "data-chatgpt-layer-product-composer-appearance";
    const SURFACE_ATTRIBUTE = "data-chatgpt-layer-product-composer-surface";
    const STYLE_ID = "chatgpt-layer-product-composer-style";
    const COLOR_PROPERTY = "--cglp-composer-background";
    const EDITOR_SELECTOR = [
      "#prompt-textarea",
      'textarea[data-id="root"]',
      "form textarea",
      'form [contenteditable="true"]',
      'form [contenteditable="plaintext-only"]'
    ].join(", ");
    const EXPLICIT_SURFACE_SELECTOR = [
      '[data-type="unified-composer"]',
      '[data-testid="composer"]',
      '[data-testid="composer-surface"]'
    ].join(", ");
    const MAX_ANCESTOR_DEPTH = 12;
    const MIN_SURFACE_WIDTH = 220;
    const MAX_SURFACE_HEIGHT = 320;
    const SUPPORTED_APPEARANCES = new Set(["solid", "wood"]);
    
    function createComposerBackgroundFeature({
      document,
      MutationObserver = globalThis.MutationObserver,
      getComputedStyle = globalThis.getComputedStyle,
      requestAnimationFrame = globalThis.requestAnimationFrame?.bind(globalThis),
      cancelAnimationFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
      queueMicrotask = globalThis.queueMicrotask?.bind(globalThis)
    }) {
      if (
        !document?.head ||
        !document?.body ||
        !document?.documentElement ||
        typeof document.querySelector !== "function"
      ) {
        throw new TypeError("Composer background feature requires a browser document.");
      }
    
      const root = document.documentElement;
      let activeColor = null;
      let activeAppearance = "solid";
      let activeSurface = null;
      let observer = null;
      let rootOriginal = null;
      let refreshScheduled = false;
      let scheduledFrame = null;
      let scheduleGeneration = 0;
      let refreshing = false;
      let woodState = "unknown";
      const surfaceOriginals = new WeakMap();
      const woodDesk = createWoodDeskController({ document });
    
      function apply(color, appearance = "solid") {
        activeColor = color;
        activeAppearance = normalizeAppearance(appearance);
        ensureStyle(document);
        decorateRoot(activeColor, activeAppearance);
        startObserver();
        refresh();
      }
    
      function refresh() {
        if (!activeColor || refreshing) return;
        refreshing = true;
    
        try {
          decorateRoot(activeColor, activeAppearance);
          const nextSurface = findComposerSurface(document, getComputedStyle);
          if (nextSurface !== activeSurface) {
            ensureWoodCleared();
            restoreSurface(activeSurface);
            activeSurface = nextSurface;
          }
    
          if (!activeSurface) return;
    
          decorateSurface(activeSurface, activeAppearance);
          if (activeAppearance === "wood") {
            woodDesk.apply(activeSurface);
            woodState = "active";
          } else {
            ensureWoodCleared();
          }
        } finally {
          refreshing = false;
        }
      }
    
      function scheduleRefresh() {
        if (!activeColor || refreshScheduled) return;
        refreshScheduled = true;
        const generation = ++scheduleGeneration;
    
        const run = () => {
          if (generation !== scheduleGeneration) return;
          refreshScheduled = false;
          scheduledFrame = null;
          refresh();
        };
    
        if (typeof requestAnimationFrame === "function") {
          scheduledFrame = requestAnimationFrame(run);
          return;
        }
    
        if (typeof queueMicrotask === "function") {
          queueMicrotask(run);
          return;
        }
    
        Promise.resolve().then(run);
      }
    
      function cancelScheduledRefresh() {
        scheduleGeneration += 1;
        refreshScheduled = false;
        if (scheduledFrame !== null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(scheduledFrame);
        }
        scheduledFrame = null;
      }
    
      function clear() {
        activeColor = null;
        activeAppearance = "solid";
        cancelScheduledRefresh();
        stopObserver();
        ensureWoodCleared();
        restoreSurface(activeSurface);
        activeSurface = null;
        restoreRoot();
      }
    
      function destroy() {
        clear();
        woodDesk.destroy();
      }
    
      function startObserver() {
        if (observer || typeof MutationObserver !== "function") return;
        observer = new MutationObserver((records) => {
          if (mutationsMayAffectComposer(records, activeSurface)) {
            scheduleRefresh();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    
      function stopObserver() {
        observer?.disconnect();
        observer = null;
      }
    
      function ensureWoodCleared() {
        if (woodState === "clear") return;
        woodDesk.clear();
        woodState = "clear";
      }
    
      function decorateRoot(color, appearance) {
        if (!rootOriginal) {
          rootOriginal = {
            attribute: root.getAttribute?.(ROOT_ATTRIBUTE) ?? null,
            appearance: root.getAttribute?.(APPEARANCE_ATTRIBUTE) ?? null,
            color: root.style?.getPropertyValue?.(COLOR_PROPERTY) ?? "",
            priority: root.style?.getPropertyPriority?.(COLOR_PROPERTY) ?? ""
          };
        }
    
        setAttributeIfChanged(root, ROOT_ATTRIBUTE, "on");
        setAttributeIfChanged(root, APPEARANCE_ATTRIBUTE, appearance);
        setImportantPropertyIfChanged(root.style, COLOR_PROPERTY, color);
      }
    
      function restoreRoot() {
        if (!rootOriginal) return;
    
        restoreAttribute(root, ROOT_ATTRIBUTE, rootOriginal.attribute);
        restoreAttribute(root, APPEARANCE_ATTRIBUTE, rootOriginal.appearance);
    
        if (rootOriginal.color) {
          root.style?.setProperty?.(
            COLOR_PROPERTY,
            rootOriginal.color,
            rootOriginal.priority || ""
          );
        } else {
          root.style?.removeProperty?.(COLOR_PROPERTY);
        }
    
        rootOriginal = null;
      }
    
      function decorateSurface(surface, appearance) {
        if (!surfaceOriginals.has(surface)) {
          surfaceOriginals.set(
            surface,
            surface.getAttribute?.(SURFACE_ATTRIBUTE) ?? null
          );
        }
        setAttributeIfChanged(surface, SURFACE_ATTRIBUTE, appearance);
      }
    
      function restoreSurface(surface) {
        if (!surface || !surfaceOriginals.has(surface)) return;
        const original = surfaceOriginals.get(surface);
        restoreAttribute(surface, SURFACE_ATTRIBUTE, original);
        surfaceOriginals.delete(surface);
      }
    
      return Object.freeze({ apply, refresh, clear, destroy });
    }
    
    function findComposerSurface(document, getComputedStyle = globalThis.getComputedStyle) {
      const editor = findCurrentEditor(document, getComputedStyle);
      if (!editor) return null;
    
      const explicit = editor.closest?.(EXPLICIT_SURFACE_SELECTOR);
      if (explicit && !isWoodDeskElement(explicit)) return explicit;
    
      const form = editor.closest?.("form") ?? null;
      const editorRect = safeRect(editor);
      let current = editor.parentElement;
    
      for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        if (
          !isWoodDeskElement(current) &&
          isComposerSizedSurface(current, editorRect, getComputedStyle)
        ) {
          return current;
        }
        if (current === form || current === document.body) break;
        current = current.parentElement;
      }
    
      return form ?? editor.parentElement ?? null;
    }
    
    function findCurrentEditor(document, getComputedStyle = globalThis.getComputedStyle) {
      const primary = document.getElementById?.("prompt-textarea") ?? null;
      if (primary && isEditorInteractive(primary, document, getComputedStyle)) {
        return primary;
      }
    
      const candidates = findEditorCandidates(document);
      let best = null;
      let bestScore = -Infinity;
    
      candidates.forEach((editor, index) => {
        if (!isEditorInteractive(editor, document, getComputedStyle)) return;
        const score = scoreEditor(editor, index, document);
        if (score > bestScore) {
          best = editor;
          bestScore = score;
        }
      });
    
      return best;
    }
    
    function mutationsMayAffectComposer(records, activeSurface = null) {
      if (!Array.isArray(records) && !(records && typeof records[Symbol.iterator] === "function")) {
        return true;
      }
      if (!activeSurface || activeSurface.isConnected === false) return true;
    
      for (const record of records) {
        if (!record || record.type !== "childList") continue;
    
        for (const node of toNodeList(record.removedNodes)) {
          if (node === activeSurface || nodeContains(node, activeSurface)) return true;
          if (nodeMatchesOrContainsEditor(node)) return true;
        }
    
        for (const node of toNodeList(record.addedNodes)) {
          if (node === activeSurface) continue;
          if (nodeContains(node, activeSurface)) continue;
          if (nodeMatchesOrContainsEditor(node)) return true;
        }
      }
    
      return false;
    }
    
    function findEditorCandidates(document) {
      const candidates = [];
    
      if (typeof document.querySelectorAll === "function") {
        candidates.push(...document.querySelectorAll(EDITOR_SELECTOR));
      } else {
        const first = document.querySelector?.(EDITOR_SELECTOR);
        if (first) candidates.push(first);
      }
    
      const active = document.activeElement;
      if (active) {
        const activeEditor = active.matches?.(EDITOR_SELECTOR)
          ? active
          : active.closest?.(EDITOR_SELECTOR);
        if (activeEditor && !candidates.includes(activeEditor)) {
          candidates.push(activeEditor);
        }
      }
    
      return candidates;
    }
    
    function isEditorInteractive(editor, document, getComputedStyle) {
      if (!editor || editor.isConnected === false || editor.hidden) return false;
      if (editor.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
      if (editor.getAttribute?.("aria-disabled") === "true") return false;
      if (editor.hasAttribute?.("disabled")) return false;
      if ("readOnly" in editor && editor.readOnly) return false;
    
      if (typeof getComputedStyle === "function") {
        try {
          const style = getComputedStyle(editor);
          if (
            style?.display === "none" ||
            style?.visibility === "hidden" ||
            Number(style?.opacity ?? 1) <= 0.01 ||
            style?.pointerEvents === "none"
          ) {
            return false;
          }
        } catch {
          // Geometry and style checks are best-effort on a changing host DOM.
        }
      }
    
      const rect = safeRect(editor);
      if (rect && (rect.width < 16 || rect.height < 16)) return false;
    
      const viewport = getViewportBounds(document.defaultView ?? globalThis);
      if (rect && viewport) {
        const right = viewport.left + viewport.width;
        const bottom = viewport.top + viewport.height;
        if (
          rect.right <= viewport.left ||
          rect.left >= right ||
          rect.bottom <= viewport.top ||
          rect.top >= bottom
        ) {
          return false;
        }
      }
    
      return true;
    }
    
    function scoreEditor(editor, domIndex, document) {
      let score = domIndex / 1000;
      const active = document.activeElement;
    
      if (active === editor || editor.contains?.(active)) score += 1200;
      if (editor.id === "prompt-textarea") score += 420;
      if (editor.closest?.(EXPLICIT_SURFACE_SELECTOR)) score += 360;
      if (editor.closest?.("form")) score += 120;
      if (editor.isContentEditable) score += 80;
    
      const rect = safeRect(editor);
      const viewport = getViewportBounds(document.defaultView ?? globalThis);
      if (rect && viewport) {
        const viewportBottom = viewport.top + viewport.height;
        score += Math.max(0, 280 - Math.abs(viewportBottom - rect.bottom));
        score += Math.min(100, (rect.width * rect.height) / 1600);
        score += editorHitTestScore(editor, rect, document);
      }
    
      return score;
    }
    
    function editorHitTestScore(editor, rect, document) {
      if (typeof document.elementFromPoint !== "function") return 0;
    
      const x = Math.min(rect.right - 2, Math.max(rect.left + 2, rect.left + rect.width / 2));
      const y = Math.min(rect.bottom - 2, Math.max(rect.top + 2, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
    
      if (!hit) return 0;
      if (hit === editor || editor.contains?.(hit)) return 500;
      if (hit.contains?.(editor)) return 160;
      return 0;
    }
    
    function isComposerSizedSurface(element, editorRect, getComputedStyle) {
      const radius = readMaximumRadius(element, getComputedStyle);
      if (radius < 10) return false;
    
      const rect = safeRect(element);
      if (!rect || !editorRect) return true;
    
      return (
        rect.width >= Math.max(MIN_SURFACE_WIDTH, editorRect.width) &&
        rect.height >= editorRect.height &&
        rect.height <= MAX_SURFACE_HEIGHT
      );
    }
    
    function readMaximumRadius(element, getComputedStyle) {
      if (typeof getComputedStyle !== "function") return 0;
    
      try {
        const style = getComputedStyle(element);
        return Math.max(
          parseRadius(style?.borderTopLeftRadius),
          parseRadius(style?.borderTopRightRadius),
          parseRadius(style?.borderBottomLeftRadius),
          parseRadius(style?.borderBottomRightRadius),
          parseRadius(style?.borderRadius)
        );
      } catch {
        return 0;
      }
    }
    
    function parseRadius(value) {
      const number = Number.parseFloat(value ?? "0");
      return Number.isFinite(number) ? number : 0;
    }
    
    function safeRect(element) {
      if (typeof element?.getBoundingClientRect !== "function") return null;
    
      try {
        const rect = element.getBoundingClientRect();
        const width = Number(rect?.width) || 0;
        const height = Number(rect?.height) || 0;
        const left = Number(rect?.left) || 0;
        const top = Number(rect?.top) || 0;
        return {
          width,
          height,
          left,
          top,
          right: Number.isFinite(Number(rect?.right)) ? Number(rect.right) : left + width,
          bottom: Number.isFinite(Number(rect?.bottom)) ? Number(rect.bottom) : top + height
        };
      } catch {
        return null;
      }
    }
    
    function getViewportBounds(window) {
      const width = Number(window?.visualViewport?.width ?? window?.innerWidth);
      const height = Number(window?.visualViewport?.height ?? window?.innerHeight);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
    
      return {
        left: Number(window?.visualViewport?.offsetLeft) || 0,
        top: Number(window?.visualViewport?.offsetTop) || 0,
        width,
        height
      };
    }
    
    function nodeMatchesOrContainsEditor(node) {
      if (!node || typeof node !== "object") return false;
      if (node.matches?.(EDITOR_SELECTOR)) return true;
      return Boolean(node.querySelector?.(EDITOR_SELECTOR));
    }
    
    function nodeContains(node, target) {
      return Boolean(node?.contains?.(target));
    }
    
    function toNodeList(value) {
      if (!value) return [];
      return Array.isArray(value) ? value : Array.from(value);
    }
    
    function normalizeAppearance(value) {
      return SUPPORTED_APPEARANCES.has(value) ? value : "solid";
    }
    
    function setAttributeIfChanged(element, name, value) {
      if (element.getAttribute?.(name) !== String(value)) {
        element.setAttribute?.(name, value);
      }
    }
    
    function setImportantPropertyIfChanged(style, property, value) {
      if (!style?.setProperty) return;
      if (
        style.getPropertyValue?.(property) === value &&
        style.getPropertyPriority?.(property) === "important"
      ) {
        return;
      }
      style.setProperty(property, value, "important");
    }
    
    function restoreAttribute(element, name, value) {
      if (value === null) element.removeAttribute?.(name);
      else element.setAttribute?.(name, value);
    }
    
    function ensureStyle(document) {
      if (document.getElementById(STYLE_ID)) return;
    
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
    html[${ROOT_ATTRIBUTE}="on"] [class*="bg-token-composer-surface-primary"],
    html[${ROOT_ATTRIBUTE}="on"] form:has(#prompt-textarea),
    html[${ROOT_ATTRIBUTE}="on"] div:not([${WOOD_DESK_SURFACE_ATTRIBUTE}]):not([${WOOD_DESK_MAT_ATTRIBUTE}]):has(> #prompt-textarea),
    html[${ROOT_ATTRIBUTE}="on"] div:not([${WOOD_DESK_SURFACE_ATTRIBUTE}]):not([${WOOD_DESK_MAT_ATTRIBUTE}]):has(> div > #prompt-textarea),
    html[${ROOT_ATTRIBUTE}="on"] [${SURFACE_ATTRIBUTE}="solid"],
    html[${ROOT_ATTRIBUTE}="on"] [${SURFACE_ATTRIBUTE}="wood"] {
      --composer-surface-primary: var(${COLOR_PROPERTY}) !important;
      --composer-surface-secondary: var(${COLOR_PROPERTY}) !important;
      background-color: var(${COLOR_PROPERTY}) !important;
    }
    
    html[${ROOT_ATTRIBUTE}="on"] [${WOOD_DESK_SURFACE_ATTRIBUTE}="on"] {
      position: relative !important;
      isolation: isolate !important;
      display: block !important;
      box-sizing: border-box !important;
      width: 100% !important;
      min-width: 0 !important;
      padding: 6px !important;
      border: 0 !important;
      border-radius: 28px !important;
      background-color: #38252d !important;
      background-image:
        repeating-linear-gradient(92deg, rgba(244, 178, 145, 0.28) 0, rgba(244, 178, 145, 0.28) 1px, transparent 1px, transparent 7px),
        repeating-linear-gradient(88deg, transparent 0, transparent 14px, rgba(244, 178, 145, 0.28) 15px, transparent 16px),
        linear-gradient(180deg, #4a3035, #2e2029) !important;
      background-size: auto !important;
      background-position: 0 0 !important;
      background-blend-mode: normal !important;
      background-clip: padding-box !important;
      box-shadow:
        0 12px 36px -11px rgba(7, 3, 8, 0.48),
        inset 0 1px 0 rgba(255, 225, 214, 0.11) !important;
      overflow: visible !important;
    }
    
    html[${ROOT_ATTRIBUTE}="on"] [${WOOD_DESK_MAT_ATTRIBUTE}="on"] {
      position: relative !important;
      display: block !important;
      box-sizing: border-box !important;
      width: 100% !important;
      min-width: 0 !important;
      padding: 3px !important;
      border: 1px solid rgba(255, 245, 252, 0.08) !important;
      border-radius: 22px !important;
      background: #5a5360 !important;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.18) !important;
      overflow: hidden !important;
    }
    
    html[${ROOT_ATTRIBUTE}="on"] [${WOOD_DESK_MAT_ATTRIBUTE}="on"] > [${WOOD_DESK_SLOT_ATTRIBUTE}="on"] {
      display: block !important;
      box-sizing: border-box !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      margin: 0 !important;
      background-color: var(${COLOR_PROPERTY}) !important;
      background-image: none !important;
      box-shadow: none !important;
    }
    `;
      document.head.append(style);
    }
    return { createComposerBackgroundFeature, findComposerSurface, findCurrentEditor, mutationsMayAffectComposer };
  })();
  __modules["src/features/conversation-actions.js"] = (() => {
    const CONVERSATION_ITEM_SELECTORS = Object.freeze([
      'main [data-message-author-role]',
      'main [data-testid^="conversation-turn"]',
      'main article[data-testid^="conversation-turn"]',
      'main article'
    ]);
    
    const SCROLLABLE_OVERFLOW = new Set(["auto", "scroll", "overlay"]);
    
    function scrollConversationToBottom({
      document,
      window = globalThis,
      getComputedStyle = globalThis.getComputedStyle,
      behavior = "smooth"
    }) {
      if (!document) {
        throw new TypeError("Scroll-to-bottom requires a browser document.");
      }
    
      const target = findConversationEndTarget(document);
      const scrollContainer = findScrollableAncestor(target, getComputedStyle)
        ?? findPrimaryScrollContainer(document, getComputedStyle)
        ?? document.scrollingElement
        ?? document.documentElement
        ?? document.body;
    
      let handled = false;
    
      if (target?.scrollIntoView) {
        target.scrollIntoView({
          behavior,
          block: "end",
          inline: "nearest"
        });
        handled = true;
      }
    
      if (scrollContainer) {
        const top = Number(scrollContainer.scrollHeight) || 0;
        if (typeof scrollContainer.scrollTo === "function") {
          scrollContainer.scrollTo({ top, behavior });
          handled = true;
        } else if ("scrollTop" in scrollContainer) {
          scrollContainer.scrollTop = top;
          handled = true;
        }
      } else if (typeof window?.scrollTo === "function") {
        const top = Math.max(
          Number(document.documentElement?.scrollHeight) || 0,
          Number(document.body?.scrollHeight) || 0
        );
        window.scrollTo({ top, behavior });
        handled = true;
      }
    
      return handled;
    }
    
    function reloadCurrentPage(location = globalThis.location) {
      if (!location || typeof location.reload !== "function") {
        throw new TypeError("Reload action requires a browser location.");
      }
      location.reload();
    }
    
    function findConversationEndTarget(document) {
      if (typeof document?.querySelectorAll !== "function") {
        return null;
      }
    
      for (const selector of CONVERSATION_ITEM_SELECTORS) {
        const matches = [...document.querySelectorAll(selector)];
        const target = matches.at(-1);
        if (target) return target;
      }
    
      return document.querySelector?.("main, [role='main']") ?? null;
    }
    
    function findScrollableAncestor(element, getComputedStyle = globalThis.getComputedStyle) {
      let current = element?.parentElement ?? null;
    
      while (current) {
        if (isScrollableElement(current, getComputedStyle)) {
          return current;
        }
        current = current.parentElement;
      }
    
      return null;
    }
    
    function findPrimaryScrollContainer(document, getComputedStyle) {
      if (typeof document?.querySelectorAll !== "function") {
        return null;
      }
    
      const candidates = document.querySelectorAll(
        "main, [role='main'], main > div, [role='main'] > div"
      );
    
      for (const candidate of candidates) {
        if (isScrollableElement(candidate, getComputedStyle)) {
          return candidate;
        }
      }
    
      return null;
    }
    
    function isScrollableElement(element, getComputedStyle) {
      const scrollHeight = Number(element?.scrollHeight) || 0;
      const clientHeight = Number(element?.clientHeight) || 0;
      if (scrollHeight <= clientHeight + 1) {
        return false;
      }
    
      if (typeof getComputedStyle !== "function") {
        return true;
      }
    
      try {
        const style = getComputedStyle(element);
        const overflowY = String(style?.overflowY ?? style?.overflow ?? "").toLowerCase();
        return SCROLLABLE_OVERFLOW.has(overflowY);
      } catch {
        return true;
      }
    }
    return { scrollConversationToBottom, reloadCurrentPage, findConversationEndTarget, findScrollableAncestor };
  })();
  __modules["src/features/page-background.js"] = (() => {
    const ROOT_ATTRIBUTE = "data-chatgpt-layer-product-page-theme";
    const STYLE_ID = "chatgpt-layer-product-page-style";
    const COLOR_PROPERTY = "--cglp-page-background";
    const CHATGPT_PROPERTIES = Object.freeze([
      "--main-surface-primary",
      "--main-surface-secondary",
      "--main-surface-background"
    ]);
    
    function createPageBackgroundFeature({ document }) {
      if (!document?.documentElement || !document?.head) {
        throw new TypeError("Page background feature requires a browser document.");
      }
    
      const root = document.documentElement;
      const originalValues = new Map();
      let active = false;
    
      function apply(color) {
        ensureStyle(document);
        captureOriginalValues();
    
        root.setAttribute(ROOT_ATTRIBUTE, "on");
        root.style.setProperty(COLOR_PROPERTY, color);
        for (const property of CHATGPT_PROPERTIES) {
          root.style.setProperty(property, color);
        }
        active = true;
      }
    
      function clear() {
        root.removeAttribute(ROOT_ATTRIBUTE);
        if (!active) {
          return;
        }
    
        restoreProperty(COLOR_PROPERTY);
        for (const property of CHATGPT_PROPERTIES) {
          restoreProperty(property);
        }
        originalValues.clear();
        active = false;
      }
    
      function captureOriginalValues() {
        if (active || originalValues.size > 0) {
          return;
        }
        originalValues.set(COLOR_PROPERTY, root.style.getPropertyValue(COLOR_PROPERTY));
        for (const property of CHATGPT_PROPERTIES) {
          originalValues.set(property, root.style.getPropertyValue(property));
        }
      }
    
      function restoreProperty(property) {
        const original = originalValues.get(property);
        if (original) {
          root.style.setProperty(property, original);
        } else {
          root.style.removeProperty(property);
        }
      }
    
      return Object.freeze({ apply, clear });
    }
    
    function ensureStyle(document) {
      if (document.getElementById(STYLE_ID)) {
        return;
      }
    
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
    html[${ROOT_ATTRIBUTE}="on"],
    html[${ROOT_ATTRIBUTE}="on"] body,
    html[${ROOT_ATTRIBUTE}="on"] #__next,
    html[${ROOT_ATTRIBUTE}="on"] main,
    html[${ROOT_ATTRIBUTE}="on"] [role="main"] {
      background-color: var(${COLOR_PROPERTY}) !important;
    }
    `;
      document.head.append(style);
    }
    return { createPageBackgroundFeature };
  })();
  __modules["src/product-identity.js"] = (() => {
    const PRODUCT_NAME = "Room Layer";
    const PUBLISHER_NAME = "Shion Works";
    const PRODUCT_URL = "https://shion-works.itch.io/room-layer";
    const LEGACY_PRODUCT_NAME = "ChatGPT Layer v0.11.0";
    
    const PUBLIC_DISTRIBUTION_BASE_URL =
      "https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/channels";
    
    const DEVELOPMENT_SCRIPT_NAME = `${PRODUCT_NAME} Dev`;
    const DEVELOPMENT_NAMESPACE =
      "https://github.com/takuyarisa-collab/chatgpt-layer-product";
    const DEVELOPMENT_VERSION = "0.3.0-dev12.1";
    const DEVELOPMENT_UPDATE_URL =
      `${PUBLIC_DISTRIBUTION_BASE_URL}/dev/room-layer-dev.meta.js`;
    const DEVELOPMENT_DOWNLOAD_URL =
      `${PUBLIC_DISTRIBUTION_BASE_URL}/dev/room-layer-dev.user.js`;
    
    const PUBLIC_SCRIPT_NAME = PRODUCT_NAME;
    const PUBLIC_NAMESPACE = PRODUCT_URL;
    const PUBLIC_UPDATE_URL =
      `${PUBLIC_DISTRIBUTION_BASE_URL}/stable/room-layer.meta.js`;
    const PUBLIC_DOWNLOAD_URL =
      `${PUBLIC_DISTRIBUTION_BASE_URL}/stable/room-layer.user.js`;
    
    const PRODUCT_IDENTITY = Object.freeze({
      name: PRODUCT_NAME,
      publisher: PUBLISHER_NAME,
      url: PRODUCT_URL,
      legacyReference: LEGACY_PRODUCT_NAME
    });
    
    const UPDATE_CHANNELS = Object.freeze({
      development: Object.freeze({
        scriptName: DEVELOPMENT_SCRIPT_NAME,
        namespace: DEVELOPMENT_NAMESPACE,
        version: DEVELOPMENT_VERSION,
        updateUrl: DEVELOPMENT_UPDATE_URL,
        downloadUrl: DEVELOPMENT_DOWNLOAD_URL
      }),
      public: Object.freeze({
        scriptName: PUBLIC_SCRIPT_NAME,
        namespace: PUBLIC_NAMESPACE,
        updateUrl: PUBLIC_UPDATE_URL,
        downloadUrl: PUBLIC_DOWNLOAD_URL
      })
    });
    return { PRODUCT_NAME, PUBLISHER_NAME, PRODUCT_URL, LEGACY_PRODUCT_NAME, PUBLIC_DISTRIBUTION_BASE_URL, DEVELOPMENT_SCRIPT_NAME, DEVELOPMENT_NAMESPACE, DEVELOPMENT_VERSION, DEVELOPMENT_UPDATE_URL, DEVELOPMENT_DOWNLOAD_URL, PUBLIC_SCRIPT_NAME, PUBLIC_NAMESPACE, PUBLIC_UPDATE_URL, PUBLIC_DOWNLOAD_URL, PRODUCT_IDENTITY, UPDATE_CHANNELS };
  })();
  __modules["src/i18n/messages.js"] = (() => {
    const { PRODUCT_NAME } = __modules["src/product-identity.js"];
    
    const DEFAULT_LANGUAGE = "en";
    const PRODUCT_LANGUAGES = Object.freeze(["en", "ja"]);
    
    const MESSAGES = Object.freeze({
      en: Object.freeze({
        "settings.title": `${PRODUCT_NAME} settings`,
        "settings.language": "Language",
        "settings.launcher": "Settings button",
        "settings.launcherHelp": "Drag the floating button to move it. It snaps to the nearest edge.",
        "settings.utilityActions": "Quick actions",
        "settings.utilityActionsHelp": "Drag the ↓ / ↻ / ⇄ group to move it. It snaps to the nearest edge.",
        "language.auto": "Device language",
        "language.en": "English",
        "language.ja": "Japanese",
        "scope.label": "Apply to",
        "scope.global": "All chats",
        "scope.project": "This project",
        "scope.chat": "This chat",
        "theme.pageBackground": "Page background",
        "theme.composerBackground": "Composer background",
        "theme.composerAppearance": "Composer style",
        "theme.composerAppearanceHelp": "Wood desk recreates the layered wood treatment from ChatGPT Layer v0.11.0. The selected background color remains inside the Composer.",
        "composerAppearance.solid": "Solid",
        "composerAppearance.wood": "Wood desk",
        "update.title": "Updates",
        "update.availableShort": "Update available",
        "update.availableTitle": "A new version is available",
        "update.currentVersion": "Installed: {version}",
        "update.versionPair": "Installed {current} · Available {available}",
        "update.nativeUpdateHelp": "Open Gear's UserScript manager and update Room Layer Dev there. Do not uninstall or reinstall the script.",
        "backup.exportTitle": "Export settings",
        "backup.importTitle": "Import settings",
        "backup.importHelp": "Paste a settings backup below.",
        "action.save": "Save",
        "action.cancel": "Cancel",
        "action.close": "Close",
        "action.copy": "Copy",
        "action.applyImport": "Import settings",
        "action.export": "Export",
        "action.import": "Import",
        "action.reset": "Reset",
        "action.resetLauncher": "Reset button position",
        "action.resetUtilityActions": "Reset quick-action position",
        "action.scrollToBottom": "Scroll to bottom",
        "action.reload": "Reload ChatGPT",
        "action.switchTab": "Switch to next ChatGPT tab",
        "action.checkUpdate": "Check for updates",
        "action.installUpdate": "Update in Gear",
        "status.saved": "Settings saved.",
        "status.imported": "Settings imported.",
        "status.reset": "Settings reset.",
        "status.launcherReset": "Button position reset.",
        "status.utilityActionsReset": "Quick-action position reset.",
        "status.copied": "Copied to the clipboard.",
        "status.recovered": "Settings were restored from a backup.",
        "status.updateAvailable": "A new Room Layer version is available.",
        "status.updateCurrent": "Room Layer is up to date.",
        "status.tabNavigationConnecting": "Connecting to Room Layer tab navigation…",
        "confirm.reset": `Reset all ${PRODUCT_NAME} settings?`,
        "error.noProject": "This page is not inside a ChatGPT project.",
        "error.noChat": "Open a conversation before applying settings to this chat.",
        "error.storageUnavailable": "Gear storage is unavailable.",
        "error.invalidImport": "The selected backup is not valid.",
        "error.updateCheckFailed": "Could not check for updates.",
        "error.tabNavigationUnavailable": "Room Layer tab navigation extension is not connected.",
        "error.tabNavigationIncompatible": "Room Layer tab navigation extension is incompatible with this build.",
        "error.tabNavigationNotEnoughTabs": "Open at least two recognizable ChatGPT tabs in the same Gear window.",
        "error.tabNavigationTargetNotFound": "Could not identify the next ChatGPT tab.",
        "error.tabNavigationFailed": "Could not switch ChatGPT tabs.",
        "error.operationFailed": "The operation failed."
      }),
      ja: Object.freeze({
        "settings.title": `${PRODUCT_NAME} 設定`,
        "settings.language": "言語",
        "settings.launcher": "設定ボタン",
        "settings.launcherHelp": "画面上の設定ボタンをドラッグして移動できます。離すと左右の端へ吸着します。",
        "settings.utilityActions": "クイック操作",
        "settings.utilityActionsHelp": "↓／↻／⇄の3ボタンをまとめてドラッグできます。離すと左右の端へ吸着します。",
        "language.auto": "端末の言語",
        "language.en": "English",
        "language.ja": "日本語",
        "scope.label": "適用先",
        "scope.global": "すべてのチャット",
        "scope.project": "このプロジェクト",
        "scope.chat": "このチャット",
        "theme.pageBackground": "ページ背景",
        "theme.composerBackground": "入力欄の背景",
        "theme.composerAppearance": "入力欄スタイル",
        "theme.composerAppearanceHelp": "木目デスクはChatGPT Layer v0.11.0の木目外装を再現します。選択した背景色は入力欄の内側に使われます。",
        "composerAppearance.solid": "単色",
        "composerAppearance.wood": "木目デスク",
        "update.title": "アップデート",
        "update.availableShort": "更新あり",
        "update.availableTitle": "新しいバージョンがあります",
        "update.currentVersion": "インストール済み：{version}",
        "update.versionPair": "現在 {current}・最新 {available}",
        "update.nativeUpdateHelp": "GearのUserScript一覧からRoom Layer Devを更新してください。アンインストールや再インストールは不要です。",
        "backup.exportTitle": "設定をエクスポート",
        "backup.importTitle": "設定をインポート",
        "backup.importHelp": "設定バックアップを下に貼り付けてください。",
        "action.save": "保存",
        "action.cancel": "キャンセル",
        "action.close": "閉じる",
        "action.copy": "コピー",
        "action.applyImport": "設定を読み込む",
        "action.export": "エクスポート",
        "action.import": "インポート",
        "action.reset": "リセット",
        "action.resetLauncher": "設定ボタン位置を初期化",
        "action.resetUtilityActions": "クイック操作位置を初期化",
        "action.scrollToBottom": "最下部へ移動",
        "action.reload": "ChatGPTを再読み込み",
        "action.switchTab": "次のChatGPTタブへ切り替え",
        "action.checkUpdate": "更新を確認",
        "action.installUpdate": "Gearで更新",
        "status.saved": "設定を保存しました。",
        "status.imported": "設定を読み込みました。",
        "status.reset": "設定をリセットしました。",
        "status.launcherReset": "設定ボタンの位置を初期化しました。",
        "status.utilityActionsReset": "クイック操作の位置を初期化しました。",
        "status.copied": "クリップボードへコピーしました。",
        "status.recovered": "バックアップから設定を復旧しました。",
        "status.updateAvailable": "新しいRoom Layerがあります。",
        "status.updateCurrent": "Room Layerは最新です。",
        "status.tabNavigationConnecting": "Room Layerタブ切り替えへ接続中…",
        "confirm.reset": `${PRODUCT_NAME}の設定をすべてリセットしますか？`,
        "error.noProject": "このページはChatGPTプロジェクト内ではありません。",
        "error.noChat": "このチャットに適用するには会話を開いてください。",
        "error.storageUnavailable": "Gearの保存機能を利用できません。",
        "error.invalidImport": "選択したバックアップは有効ではありません。",
        "error.updateCheckFailed": "アップデートを確認できませんでした。",
        "error.tabNavigationUnavailable": "Room Layerのタブ切り替え拡張へ接続できません。",
        "error.tabNavigationIncompatible": "タブ切り替え拡張のバージョンに互換性がありません。",
        "error.tabNavigationNotEnoughTabs": "同じGearウィンドウで判別できるChatGPTタブを2枚以上開いてください。",
        "error.tabNavigationTargetNotFound": "次のChatGPTタブを特定できませんでした。",
        "error.tabNavigationFailed": "ChatGPTタブを切り替えられませんでした。",
        "error.operationFailed": "処理に失敗しました。"
      })
    });
    
    function resolveLanguage(preference = "auto", navigatorLanguages = []) {
      if (PRODUCT_LANGUAGES.includes(preference)) {
        return preference;
      }
    
      const candidates = Array.isArray(navigatorLanguages)
        ? navigatorLanguages
        : [navigatorLanguages];
    
      for (const candidate of candidates) {
        if (typeof candidate !== "string") {
          continue;
        }
        const primary = candidate.trim().toLowerCase().split("-")[0];
        if (PRODUCT_LANGUAGES.includes(primary)) {
          return primary;
        }
      }
    
      return DEFAULT_LANGUAGE;
    }
    
    function createTranslator({
      language = "auto",
      navigatorLanguages = globalThis.navigator?.languages ?? [globalThis.navigator?.language]
    } = {}) {
      const resolvedLanguage = resolveLanguage(language, navigatorLanguages);
    
      function translate(key, parameters = {}) {
        const template =
          MESSAGES[resolvedLanguage]?.[key] ??
          MESSAGES[DEFAULT_LANGUAGE]?.[key] ??
          key;
    
        return interpolate(template, parameters);
      }
    
      return Object.freeze({
        language: resolvedLanguage,
        t: translate
      });
    }
    
    function interpolate(template, parameters) {
      return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
        if (!Object.prototype.hasOwnProperty.call(parameters, key)) {
          return match;
        }
        return String(parameters[key]);
      });
    }
    return { DEFAULT_LANGUAGE, PRODUCT_LANGUAGES, MESSAGES, resolveLanguage, createTranslator };
  })();
  __modules["src/storage/settings-store.js"] = (() => {
    const { SettingsValidationError, createDefaultSettings, normalizeSettings } = __modules["src/core/schema-v1.js"];
    
    const DEFAULT_SETTINGS_KEY = "chatgpt-layer.settings.v1";
    const DEFAULT_BACKUP_KEY = "chatgpt-layer.settings.v1.backup";
    
    class SettingsImportError extends Error {
      constructor(code, message, cause = null) {
        super(message);
        this.name = "SettingsImportError";
        this.code = code;
        this.cause = cause;
      }
    }
    
    function createSettingsStore({
      backend,
      settingsKey = DEFAULT_SETTINGS_KEY,
      backupKey = DEFAULT_BACKUP_KEY
    }) {
      assertBackend(backend);
    
      async function load() {
        const warnings = [];
        const primary = await readValidDocument(backend, settingsKey);
    
        if (primary.status === "valid") {
          return {
            settings: primary.settings,
            source: "primary",
            recovered: false,
            warnings
          };
        }
    
        if (primary.status === "invalid") {
          warnings.push({
            code: "invalid_primary",
            errors: primary.errors
          });
        }
    
        const backup = await readValidDocument(backend, backupKey);
        if (backup.status === "valid") {
          await backend.set(settingsKey, serializeSettings(backup.settings));
          warnings.push({ code: "recovered_from_backup" });
          return {
            settings: backup.settings,
            source: "backup",
            recovered: true,
            warnings
          };
        }
    
        if (backup.status === "invalid") {
          warnings.push({
            code: "invalid_backup",
            errors: backup.errors
          });
        }
    
        return {
          settings: createDefaultSettings(),
          source: "default",
          recovered: false,
          warnings
        };
      }
    
      async function save(value) {
        const normalized = normalizeSettings(value);
        const current = await readValidDocument(backend, settingsKey);
    
        if (current.status === "valid") {
          await backend.set(backupKey, serializeSettings(current.settings));
        }
    
        await backend.set(settingsKey, serializeSettings(normalized));
        return normalized;
      }
    
      async function importFromJson(jsonText) {
        if (typeof jsonText !== "string") {
          throw new SettingsImportError("invalid_input", "Import data must be JSON text.");
        }
    
        let parsed;
        try {
          parsed = JSON.parse(jsonText);
        } catch (error) {
          throw new SettingsImportError("invalid_json", "Import data is not valid JSON.", error);
        }
    
        try {
          return await save(parsed);
        } catch (error) {
          if (error instanceof SettingsValidationError) {
            throw new SettingsImportError("invalid_settings", "Import data failed settings validation.", error);
          }
          throw error;
        }
      }
    
      async function exportToJson() {
        const result = await load();
        return `${JSON.stringify(result.settings, null, 2)}\n`;
      }
    
      async function reset() {
        return save(createDefaultSettings());
      }
    
      return Object.freeze({
        load,
        save,
        importFromJson,
        exportToJson,
        reset,
        settingsKey,
        backupKey
      });
    }
    
    async function readValidDocument(backend, key) {
      const raw = await backend.get(key);
    
      if (raw === null || raw === undefined) {
        return { status: "missing" };
      }
    
      if (typeof raw !== "string") {
        return {
          status: "invalid",
          errors: [{ path: "$", code: "invalid_storage_type", message: "Stored value must be JSON text." }]
        };
      }
    
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return {
          status: "invalid",
          errors: [{ path: "$", code: "invalid_json", message: "Stored value is not valid JSON." }]
        };
      }
    
      try {
        return {
          status: "valid",
          settings: normalizeSettings(parsed)
        };
      } catch (error) {
        if (error instanceof SettingsValidationError) {
          return {
            status: "invalid",
            errors: error.errors
          };
        }
        throw error;
      }
    }
    
    function serializeSettings(settings) {
      return JSON.stringify(settings);
    }
    
    function assertBackend(backend) {
      if (
        backend === null ||
        typeof backend !== "object" ||
        typeof backend.get !== "function" ||
        typeof backend.set !== "function" ||
        typeof backend.remove !== "function"
      ) {
        throw new TypeError("Storage backend must provide async get, set, and remove methods.");
      }
    }
    return { DEFAULT_SETTINGS_KEY, DEFAULT_BACKUP_KEY, SettingsImportError, createSettingsStore };
  })();
  __modules["src/ui/launcher-position.js"] = (() => {
    const DEFAULT_LAUNCHER_POSITION = Object.freeze({
      side: "right",
      y: 0.7
    });
    
    const DEFAULT_MARGIN = 16;
    const DEFAULT_SIZE = 44;
    const DRAG_THRESHOLD = 7;
    const DRAGGING_ATTRIBUTE = "data-cglp-dragging";
    const RESTING_TRANSFORM = "translate3d(0px, 0px, 0px)";
    
    function normalizeLauncherPosition(value, fallback = DEFAULT_LAUNCHER_POSITION) {
      const side = value?.side === "left" || value?.side === "right"
        ? value.side
        : fallback.side;
      const rawY = Number(value?.y);
      const fallbackY = Number.isFinite(Number(fallback?.y)) ? Number(fallback.y) : 0.7;
      const y = Number.isFinite(rawY) ? clamp(rawY, 0, 1) : clamp(fallbackY, 0, 1);
      return Object.freeze({ side, y });
    }
    
    function getLauncherCoordinates({
      position,
      viewport,
      size = DEFAULT_SIZE,
      margin = DEFAULT_MARGIN
    }) {
      const normalized = normalizeLauncherPosition(position);
      const bounds = normalizeViewport(viewport);
      const launcherSize = positiveNumber(size, DEFAULT_SIZE);
      const edgeMargin = nonNegativeNumber(margin, DEFAULT_MARGIN);
      const minLeft = bounds.left + edgeMargin;
      const maxLeft = Math.max(minLeft, bounds.left + bounds.width - edgeMargin - launcherSize);
      const minTop = bounds.top + edgeMargin;
      const maxTop = Math.max(minTop, bounds.top + bounds.height - edgeMargin - launcherSize);
      const left = normalized.side === "left" ? minLeft : maxLeft;
      const desiredCenterY = bounds.top + normalized.y * bounds.height;
      const top = clamp(desiredCenterY - launcherSize / 2, minTop, maxTop);
      return Object.freeze({ left, top });
    }
    
    function getLauncherPositionFromCoordinates({
      left,
      top,
      viewport,
      size = DEFAULT_SIZE
    }) {
      const bounds = normalizeViewport(viewport);
      const launcherSize = positiveNumber(size, DEFAULT_SIZE);
      const centerX = Number(left) + launcherSize / 2;
      const centerY = Number(top) + launcherSize / 2;
      const side = centerX < bounds.left + bounds.width / 2 ? "left" : "right";
      const y = bounds.height > 0
        ? clamp((centerY - bounds.top) / bounds.height, 0, 1)
        : DEFAULT_LAUNCHER_POSITION.y;
      return Object.freeze({ side, y });
    }
    
    function createLauncherPositionController({
      element,
      window,
      initialPosition = DEFAULT_LAUNCHER_POSITION,
      onActivate,
      onPositionChange
    }) {
      if (!element?.style || typeof element.addEventListener !== "function") {
        throw new TypeError("Launcher position controller requires a DOM element.");
      }
    
      const runtimeWindow = window ?? globalThis;
      let position = normalizeLauncherPosition(initialPosition);
      let drag = null;
      let suppressClick = false;
    
      prepareCompositingLayer();
      applyPosition();
    
      element.addEventListener("pointerdown", handlePointerDown);
      element.addEventListener("pointermove", handlePointerMove);
      element.addEventListener("pointerup", handlePointerUp);
      element.addEventListener("pointercancel", handlePointerCancel);
      element.addEventListener("click", handleClick);
      runtimeWindow.addEventListener?.("resize", applyPosition);
      runtimeWindow.visualViewport?.addEventListener?.("resize", applyPosition);
    
      function handlePointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;
        const rect = element.getBoundingClientRect();
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          currentLeft: rect.left,
          currentTop: rect.top,
          moved: false
        };
        setDraggingState(true);
        element.setPointerCapture?.(event.pointerId);
      }
    
      function handlePointerMove(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
    
        drag.moved = true;
        event.preventDefault?.();
        const viewport = getViewport(runtimeWindow);
        const size = getElementSize(element);
        const coordinates = clampCoordinates({
          left: drag.startLeft + deltaX,
          top: drag.startTop + deltaY,
          viewport,
          size,
          margin: DEFAULT_MARGIN
        });
        drag.currentLeft = coordinates.left;
        drag.currentTop = coordinates.top;
        applyDragTransform(coordinates);
      }
    
      function handlePointerUp(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        element.releasePointerCapture?.(event.pointerId);
    
        if (drag.moved) {
          position = getLauncherPositionFromCoordinates({
            left: drag.currentLeft,
            top: drag.currentTop,
            viewport: getViewport(runtimeWindow),
            size: getElementSize(element)
          });
          finishDrag();
          applyPosition();
          suppressClick = true;
          notifyPositionChange(position);
        } else {
          finishDrag();
          suppressClick = true;
          onActivate?.();
        }
      }
    
      function handlePointerCancel(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        element.releasePointerCapture?.(event.pointerId);
        finishDrag();
        applyPosition();
      }
    
      function handleClick(event) {
        if (suppressClick) {
          suppressClick = false;
          event.preventDefault?.();
          event.stopPropagation?.();
          return;
        }
        onActivate?.();
      }
    
      function prepareCompositingLayer() {
        element.style.transform = RESTING_TRANSFORM;
        element.style.willChange = "transform";
        element.style.backfaceVisibility = "hidden";
        element.style.webkitBackfaceVisibility = "hidden";
      }
    
      function setDraggingState(active) {
        if (active) {
          element.setAttribute?.(DRAGGING_ATTRIBUTE, "on");
          element.style.boxShadow = "0 3px 10px rgba(0,0,0,.28)";
          return;
        }
    
        element.removeAttribute?.(DRAGGING_ATTRIBUTE);
        removeInlineStyle(element.style, "box-shadow", "boxShadow");
      }
    
      function finishDrag() {
        drag = null;
        setDraggingState(false);
        element.style.transform = RESTING_TRANSFORM;
      }
    
      function applyPosition() {
        if (drag) return;
        const coordinates = getLauncherCoordinates({
          position,
          viewport: getViewport(runtimeWindow),
          size: getElementSize(element),
          margin: DEFAULT_MARGIN
        });
        applyCoordinates(coordinates);
      }
    
      function applyCoordinates({ left, top }) {
        element.style.left = `${Math.round(left)}px`;
        element.style.top = `${Math.round(top)}px`;
        element.style.right = "auto";
        element.style.bottom = "auto";
        element.style.transform = RESTING_TRANSFORM;
      }
    
      function applyDragTransform({ left, top }) {
        if (!drag) return;
        const deltaX = Math.round(left - drag.startLeft);
        const deltaY = Math.round(top - drag.startTop);
        element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0px)`;
      }
    
      function setPosition(nextPosition) {
        finishDrag();
        position = normalizeLauncherPosition(nextPosition);
        applyPosition();
      }
    
      function notifyPositionChange(nextPosition) {
        try {
          const result = onPositionChange?.(nextPosition);
          if (result?.catch) {
            result.catch((error) => console.error("[ChatGPT Layer Product] launcher position save failed", error));
          }
        } catch (error) {
          console.error("[ChatGPT Layer Product] launcher position save failed", error);
        }
      }
    
      function destroy() {
        finishDrag();
        element.removeEventListener("pointerdown", handlePointerDown);
        element.removeEventListener("pointermove", handlePointerMove);
        element.removeEventListener("pointerup", handlePointerUp);
        element.removeEventListener("pointercancel", handlePointerCancel);
        element.removeEventListener("click", handleClick);
        runtimeWindow.removeEventListener?.("resize", applyPosition);
        runtimeWindow.visualViewport?.removeEventListener?.("resize", applyPosition);
      }
    
      return Object.freeze({
        getPosition: () => position,
        setPosition,
        refresh: applyPosition,
        destroy
      });
    }
    
    function getViewport(runtimeWindow) {
      const visual = runtimeWindow.visualViewport;
      return normalizeViewport({
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? runtimeWindow.innerWidth,
        height: visual?.height ?? runtimeWindow.innerHeight
      });
    }
    
    function getElementSize(element) {
      const rect = element.getBoundingClientRect?.();
      return positiveNumber(rect?.width || element.offsetWidth, DEFAULT_SIZE);
    }
    
    function clampCoordinates({ left, top, viewport, size, margin }) {
      const bounds = normalizeViewport(viewport);
      const minLeft = bounds.left + margin;
      const maxLeft = Math.max(minLeft, bounds.left + bounds.width - margin - size);
      const minTop = bounds.top + margin;
      const maxTop = Math.max(minTop, bounds.top + bounds.height - margin - size);
      return Object.freeze({
        left: clamp(Number(left), minLeft, maxLeft),
        top: clamp(Number(top), minTop, maxTop)
      });
    }
    
    function normalizeViewport(value) {
      return Object.freeze({
        left: finiteNumber(value?.left, 0),
        top: finiteNumber(value?.top, 0),
        width: positiveNumber(value?.width, 1),
        height: positiveNumber(value?.height, 1)
      });
    }
    
    function removeInlineStyle(style, cssName, propertyName) {
      if (typeof style.removeProperty === "function") {
        style.removeProperty(cssName);
      } else {
        style[propertyName] = "";
      }
    }
    
    function finiteNumber(value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }
    
    function positiveNumber(value, fallback) {
      const number = finiteNumber(value, fallback);
      return number > 0 ? number : fallback;
    }
    
    function nonNegativeNumber(value, fallback) {
      const number = finiteNumber(value, fallback);
      return number >= 0 ? number : fallback;
    }
    
    function clamp(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    }
    return { DEFAULT_LAUNCHER_POSITION, normalizeLauncherPosition, getLauncherCoordinates, getLauncherPositionFromCoordinates, createLauncherPositionController };
  })();
  __modules["src/ui/utility-actions-position.js"] = (() => {
    const DEFAULT_UTILITY_ACTIONS_POSITION = Object.freeze({
      side: "left",
      y: 0.78
    });
    
    const DEFAULT_MARGIN = 16;
    const DEFAULT_WIDTH = 92;
    const DEFAULT_HEIGHT = 42;
    const DRAG_THRESHOLD = 7;
    const DRAGGING_ATTRIBUTE = "data-cglp-dragging";
    const RESTING_TRANSFORM = "translate3d(0px, 0px, 0px)";
    
    function normalizeUtilityActionsPosition(
      value,
      fallback = DEFAULT_UTILITY_ACTIONS_POSITION
    ) {
      const side = value?.side === "left" || value?.side === "right"
        ? value.side
        : fallback.side;
      const rawY = Number(value?.y);
      const fallbackY = Number.isFinite(Number(fallback?.y))
        ? Number(fallback.y)
        : DEFAULT_UTILITY_ACTIONS_POSITION.y;
      const y = Number.isFinite(rawY) ? clamp(rawY, 0, 1) : clamp(fallbackY, 0, 1);
      return Object.freeze({ side, y });
    }
    
    function getUtilityActionsCoordinates({
      position,
      viewport,
      width = DEFAULT_WIDTH,
      height = DEFAULT_HEIGHT,
      margin = DEFAULT_MARGIN
    }) {
      const normalized = normalizeUtilityActionsPosition(position);
      const bounds = normalizeViewport(viewport);
      const barWidth = positiveNumber(width, DEFAULT_WIDTH);
      const barHeight = positiveNumber(height, DEFAULT_HEIGHT);
      const edgeMargin = nonNegativeNumber(margin, DEFAULT_MARGIN);
      const minLeft = bounds.left + edgeMargin;
      const maxLeft = Math.max(minLeft, bounds.left + bounds.width - edgeMargin - barWidth);
      const minTop = bounds.top + edgeMargin;
      const maxTop = Math.max(minTop, bounds.top + bounds.height - edgeMargin - barHeight);
      const left = normalized.side === "left" ? minLeft : maxLeft;
      const desiredCenterY = bounds.top + normalized.y * bounds.height;
      const top = clamp(desiredCenterY - barHeight / 2, minTop, maxTop);
      return Object.freeze({ left, top });
    }
    
    function getUtilityActionsPositionFromCoordinates({
      left,
      top,
      viewport,
      width = DEFAULT_WIDTH,
      height = DEFAULT_HEIGHT
    }) {
      const bounds = normalizeViewport(viewport);
      const barWidth = positiveNumber(width, DEFAULT_WIDTH);
      const barHeight = positiveNumber(height, DEFAULT_HEIGHT);
      const centerX = Number(left) + barWidth / 2;
      const centerY = Number(top) + barHeight / 2;
      const side = centerX < bounds.left + bounds.width / 2 ? "left" : "right";
      const y = bounds.height > 0
        ? clamp((centerY - bounds.top) / bounds.height, 0, 1)
        : DEFAULT_UTILITY_ACTIONS_POSITION.y;
      return Object.freeze({ side, y });
    }
    
    function createUtilityActionsPositionController({
      element,
      window,
      initialPosition = DEFAULT_UTILITY_ACTIONS_POSITION,
      onPositionChange
    }) {
      if (!element?.style || typeof element.addEventListener !== "function") {
        throw new TypeError("Utility action position controller requires a DOM element.");
      }
    
      const runtimeWindow = window ?? globalThis;
      let position = normalizeUtilityActionsPosition(initialPosition);
      let drag = null;
      let suppressClick = false;
      let suppressTimer = null;
    
      prepareCompositingLayer();
      applyPosition();
    
      element.addEventListener("pointerdown", handlePointerDown);
      element.addEventListener("pointermove", handlePointerMove);
      element.addEventListener("pointerup", handlePointerUp);
      element.addEventListener("pointercancel", handlePointerCancel);
      element.addEventListener("click", handleClickCapture, true);
      runtimeWindow.addEventListener?.("resize", applyPosition);
      runtimeWindow.visualViewport?.addEventListener?.("resize", applyPosition);
    
      function handlePointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;
        const rect = element.getBoundingClientRect();
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          currentLeft: rect.left,
          currentTop: rect.top,
          moved: false
        };
        element.setPointerCapture?.(event.pointerId);
      }
    
      function handlePointerMove(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
    
        if (!drag.moved) {
          drag.moved = true;
          setDraggingState(true);
        }
    
        event.preventDefault?.();
        const viewport = getViewport(runtimeWindow);
        const dimensions = getElementDimensions(element);
        const coordinates = clampCoordinates({
          left: drag.startLeft + deltaX,
          top: drag.startTop + deltaY,
          viewport,
          width: dimensions.width,
          height: dimensions.height,
          margin: DEFAULT_MARGIN
        });
        drag.currentLeft = coordinates.left;
        drag.currentTop = coordinates.top;
        applyDragTransform(coordinates);
      }
    
      function handlePointerUp(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        element.releasePointerCapture?.(event.pointerId);
    
        if (drag.moved) {
          const dimensions = getElementDimensions(element);
          position = getUtilityActionsPositionFromCoordinates({
            left: drag.currentLeft,
            top: drag.currentTop,
            viewport: getViewport(runtimeWindow),
            width: dimensions.width,
            height: dimensions.height
          });
          suppressNextClick();
          finishDrag();
          applyPosition();
          notifyPositionChange(position);
          return;
        }
    
        finishDrag();
      }
    
      function handlePointerCancel(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        element.releasePointerCapture?.(event.pointerId);
        finishDrag();
        applyPosition();
      }
    
      function handleClickCapture(event) {
        if (!suppressClick) return;
        suppressClick = false;
        clearSuppressTimer();
        event.preventDefault?.();
        event.stopPropagation?.();
        event.stopImmediatePropagation?.();
      }
    
      function suppressNextClick() {
        suppressClick = true;
        clearSuppressTimer();
        suppressTimer = runtimeWindow.setTimeout?.(() => {
          suppressClick = false;
          suppressTimer = null;
        }, 500) ?? null;
      }
    
      function clearSuppressTimer() {
        if (suppressTimer !== null) {
          runtimeWindow.clearTimeout?.(suppressTimer);
          suppressTimer = null;
        }
      }
    
      function prepareCompositingLayer() {
        element.style.transform = RESTING_TRANSFORM;
        element.style.willChange = "transform";
        element.style.backfaceVisibility = "hidden";
        element.style.webkitBackfaceVisibility = "hidden";
      }
    
      function setDraggingState(active) {
        if (active) {
          element.setAttribute?.(DRAGGING_ATTRIBUTE, "on");
          return;
        }
        element.removeAttribute?.(DRAGGING_ATTRIBUTE);
      }
    
      function finishDrag() {
        drag = null;
        setDraggingState(false);
        element.style.transform = RESTING_TRANSFORM;
      }
    
      function applyPosition() {
        if (drag) return;
        const dimensions = getElementDimensions(element);
        const coordinates = getUtilityActionsCoordinates({
          position,
          viewport: getViewport(runtimeWindow),
          width: dimensions.width,
          height: dimensions.height,
          margin: DEFAULT_MARGIN
        });
        applyCoordinates(coordinates);
      }
    
      function applyCoordinates({ left, top }) {
        element.style.left = `${Math.round(left)}px`;
        element.style.top = `${Math.round(top)}px`;
        element.style.right = "auto";
        element.style.bottom = "auto";
        element.style.transform = RESTING_TRANSFORM;
      }
    
      function applyDragTransform({ left, top }) {
        if (!drag) return;
        const deltaX = Math.round(left - drag.startLeft);
        const deltaY = Math.round(top - drag.startTop);
        element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0px)`;
      }
    
      function setPosition(nextPosition) {
        finishDrag();
        position = normalizeUtilityActionsPosition(nextPosition);
        applyPosition();
      }
    
      function notifyPositionChange(nextPosition) {
        try {
          const result = onPositionChange?.(nextPosition);
          if (result?.catch) {
            result.catch((error) => console.error(
              "[ChatGPT Layer Product] utility action position save failed",
              error
            ));
          }
        } catch (error) {
          console.error("[ChatGPT Layer Product] utility action position save failed", error);
        }
      }
    
      function destroy() {
        finishDrag();
        clearSuppressTimer();
        element.removeEventListener("pointerdown", handlePointerDown);
        element.removeEventListener("pointermove", handlePointerMove);
        element.removeEventListener("pointerup", handlePointerUp);
        element.removeEventListener("pointercancel", handlePointerCancel);
        element.removeEventListener("click", handleClickCapture, true);
        runtimeWindow.removeEventListener?.("resize", applyPosition);
        runtimeWindow.visualViewport?.removeEventListener?.("resize", applyPosition);
      }
    
      return Object.freeze({
        getPosition: () => position,
        setPosition,
        refresh: applyPosition,
        destroy
      });
    }
    
    function getViewport(runtimeWindow) {
      const visual = runtimeWindow.visualViewport;
      return normalizeViewport({
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? runtimeWindow.innerWidth,
        height: visual?.height ?? runtimeWindow.innerHeight
      });
    }
    
    function getElementDimensions(element) {
      const rect = element.getBoundingClientRect?.();
      return Object.freeze({
        width: positiveNumber(rect?.width || element.offsetWidth, DEFAULT_WIDTH),
        height: positiveNumber(rect?.height || element.offsetHeight, DEFAULT_HEIGHT)
      });
    }
    
    function clampCoordinates({ left, top, viewport, width, height, margin }) {
      const bounds = normalizeViewport(viewport);
      const minLeft = bounds.left + margin;
      const maxLeft = Math.max(minLeft, bounds.left + bounds.width - margin - width);
      const minTop = bounds.top + margin;
      const maxTop = Math.max(minTop, bounds.top + bounds.height - margin - height);
      return Object.freeze({
        left: clamp(Number(left), minLeft, maxLeft),
        top: clamp(Number(top), minTop, maxTop)
      });
    }
    
    function normalizeViewport(value) {
      return Object.freeze({
        left: finiteNumber(value?.left, 0),
        top: finiteNumber(value?.top, 0),
        width: positiveNumber(value?.width, 1),
        height: positiveNumber(value?.height, 1)
      });
    }
    
    function finiteNumber(value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }
    
    function positiveNumber(value, fallback) {
      const number = finiteNumber(value, fallback);
      return number > 0 ? number : fallback;
    }
    
    function nonNegativeNumber(value, fallback) {
      const number = finiteNumber(value, fallback);
      return number >= 0 ? number : fallback;
    }
    
    function clamp(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    }
    return { DEFAULT_UTILITY_ACTIONS_POSITION, normalizeUtilityActionsPosition, getUtilityActionsCoordinates, getUtilityActionsPositionFromCoordinates, createUtilityActionsPositionController };
  })();
  __modules["src/storage/ui-preferences.js"] = (() => {
    const { DEFAULT_LAUNCHER_POSITION, normalizeLauncherPosition } = __modules["src/ui/launcher-position.js"];
    const { DEFAULT_UTILITY_ACTIONS_POSITION, normalizeUtilityActionsPosition } = __modules["src/ui/utility-actions-position.js"];
    
    const UI_PREFERENCES_KEY = "chatgpt-layer-product:ui-preferences:v1";
    
    function createUiPreferencesStore({ backend }) {
      if (!backend || typeof backend.get !== "function" || typeof backend.set !== "function") {
        throw new TypeError("UI preferences store requires a storage backend.");
      }
    
      async function loadLauncherPosition() {
        const preferences = await loadPreferences();
        return normalizeLauncherPosition(preferences.launcher);
      }
    
      async function saveLauncherPosition(position) {
        const launcher = normalizeLauncherPosition(position);
        const preferences = await loadPreferences();
        await savePreferences({ ...preferences, launcher });
        return launcher;
      }
    
      async function resetLauncherPosition() {
        const preferences = await loadPreferences();
        const { launcher: removed, ...remaining } = preferences;
        await savePreferences(remaining);
        return DEFAULT_LAUNCHER_POSITION;
      }
    
      async function loadUtilityActionsPosition() {
        const preferences = await loadPreferences();
        return normalizeUtilityActionsPosition(preferences.utilityActions);
      }
    
      async function saveUtilityActionsPosition(position) {
        const utilityActions = normalizeUtilityActionsPosition(position);
        const preferences = await loadPreferences();
        await savePreferences({ ...preferences, utilityActions });
        return utilityActions;
      }
    
      async function resetUtilityActionsPosition() {
        const preferences = await loadPreferences();
        const { utilityActions: removed, ...remaining } = preferences;
        await savePreferences(remaining);
        return DEFAULT_UTILITY_ACTIONS_POSITION;
      }
    
      async function resetAllPositions() {
        await backend.remove(UI_PREFERENCES_KEY);
        return Object.freeze({
          launcher: DEFAULT_LAUNCHER_POSITION,
          utilityActions: DEFAULT_UTILITY_ACTIONS_POSITION
        });
      }
    
      async function loadPreferences() {
        const text = await backend.get(UI_PREFERENCES_KEY);
        if (typeof text !== "string" || text.length === 0) {
          return {};
        }
    
        try {
          const value = JSON.parse(text);
          if (value?.version !== 1) return {};
          const preferences = {};
          if (value.launcher) {
            preferences.launcher = normalizeLauncherPosition(value.launcher);
          }
          if (value.utilityActions) {
            preferences.utilityActions = normalizeUtilityActionsPosition(value.utilityActions);
          }
          return preferences;
        } catch {
          return {};
        }
      }
    
      async function savePreferences(preferences) {
        const document = { version: 1 };
        if (preferences.launcher) {
          document.launcher = normalizeLauncherPosition(preferences.launcher);
        }
        if (preferences.utilityActions) {
          document.utilityActions = normalizeUtilityActionsPosition(preferences.utilityActions);
        }
    
        if (!document.launcher && !document.utilityActions) {
          await backend.remove(UI_PREFERENCES_KEY);
          return;
        }
    
        await backend.set(UI_PREFERENCES_KEY, JSON.stringify(document));
      }
    
      return Object.freeze({
        loadLauncherPosition,
        saveLauncherPosition,
        resetLauncherPosition,
        loadUtilityActionsPosition,
        saveUtilityActionsPosition,
        resetUtilityActionsPosition,
        resetAllPositions
      });
    }
    return { UI_PREFERENCES_KEY, createUiPreferencesStore };
  })();
  __modules["src/ui/settings-panel.js"] = (() => {
    const { DEFAULT_LAUNCHER_POSITION, createLauncherPositionController } = __modules["src/ui/launcher-position.js"];
    
    function createSettingsPanel({
      document,
      window,
      launcherPosition = DEFAULT_LAUNCHER_POSITION,
      onLauncherPositionChange,
      onLauncherPositionReset,
      onUtilityActionsPositionReset,
      onCheckForUpdate,
      onInstallUpdate,
      onSave,
      onExport,
      onImport,
      onReset
    }) {
      if (!document?.body || typeof document.createElement !== "function") {
        throw new TypeError("Settings panel requires a browser document.");
      }
    
      const runtimeWindow = window ?? globalThis;
      const host = document.createElement("div");
      host.id = "chatgpt-layer-product-ui";
      const shadow = host.attachShadow({ mode: "open" });
      shadow.append(createStyle(document));
    
      const launcher = element(document, "button", "launcher", "⚙");
      launcher.type = "button";
      const updateBadge = element(document, "span", "launcherBadge");
      updateBadge.hidden = true;
      updateBadge.setAttribute("aria-hidden", "true");
      launcher.append(updateBadge);
    
      const overlay = element(document, "div", "overlay");
      overlay.hidden = true;
      const sheet = element(document, "section", "sheet");
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      overlay.append(sheet);
    
      shadow.append(launcher, overlay);
      document.body.append(host);
    
      let model = null;
      let open = false;
      let status = null;
      let busy = false;
    
      const launcherController = createLauncherPositionController({
        element: launcher,
        window: runtimeWindow,
        initialPosition: launcherPosition,
        onActivate: () => setOpen(true),
        onPositionChange: onLauncherPositionChange
      });
    
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) setOpen(false);
      });
    
      function render(nextModel) {
        model = nextModel;
        renderLauncherState();
        if (open) renderEditor();
      }
    
      function setUpdateState(updateState) {
        if (!model) return;
        model = { ...model, updateState };
        renderLauncherState();
        if (open) renderEditor();
      }
    
      function renderLauncherState() {
        if (!model) return;
        const t = model.translator.t;
        const available = Boolean(model.updateState?.available);
        updateBadge.hidden = !available;
        const title = t("settings.title");
        const label = available
          ? `${title}. ${t("update.availableShort")}`
          : title;
        launcher.setAttribute("aria-label", label);
        launcher.title = label;
      }
    
      function setOpen(value) {
        open = Boolean(value);
        overlay.hidden = !open;
        if (open) renderEditor();
      }
    
      function setStatus(message, tone = "success") {
        status = { message, tone };
        if (open) renderEditor();
      }
    
      function renderEditor() {
        if (!model) return;
    
        const { translator, availableScopes } = model;
        const t = translator.t;
        sheet.replaceChildren();
    
        const header = element(document, "header", "header");
        const title = element(document, "h2", "title", t("settings.title"));
        const close = element(document, "button", "iconButton", "×");
        close.type = "button";
        close.setAttribute("aria-label", t("action.close"));
        close.addEventListener("click", () => setOpen(false));
        header.append(title, close);
    
        const form = element(document, "div", "form");
        form.append(createUpdateField());
    
        const languageSelect = createSelectField({
          document,
          label: t("settings.language"),
          value: model.language,
          options: [
            ["auto", t("language.auto")],
            ["en", t("language.en")],
            ["ja", t("language.ja")]
          ]
        });
    
        const scopeSelect = createSelectField({
          document,
          label: t("scope.label"),
          value: model.scope,
          options: availableScopes.map((scope) => [scope, t(`scope.${scope}`)])
        });
    
        const pageColor = createColorField({
          document,
          label: t("theme.pageBackground"),
          value: model.pageColor,
          fallback: "#171717"
        });
        const composerColor = createColorField({
          document,
          label: t("theme.composerBackground"),
          value: model.composerColor,
          fallback: "#303030"
        });
        const composerAppearance = createSelectField({
          document,
          label: t("theme.composerAppearance"),
          value: model.composerAppearance ?? "solid",
          options: [
            ["solid", t("composerAppearance.solid")],
            ["wood", t("composerAppearance.wood")]
          ]
        });
        composerAppearance.field.append(
          element(document, "p", "help", t("theme.composerAppearanceHelp"))
        );
    
        const launcherField = element(document, "section", "positionField");
        launcherField.append(
          element(document, "span", "label", t("settings.launcher")),
          element(document, "p", "help", t("settings.launcherHelp"))
        );
        const resetLauncher = element(
          document,
          "button",
          "positionButton",
          t("action.resetLauncher")
        );
        resetLauncher.type = "button";
        resetLauncher.disabled = busy;
        resetLauncher.addEventListener("click", async () => {
          await runOperation(async () => {
            const nextPosition = await onLauncherPositionReset?.();
            launcherController.setPosition(nextPosition ?? DEFAULT_LAUNCHER_POSITION);
            status = { message: t("status.launcherReset"), tone: "success" };
          });
        });
        launcherField.append(resetLauncher);
    
        const utilityPositionField = element(document, "section", "positionField");
        utilityPositionField.append(
          element(document, "span", "label", t("settings.utilityActions")),
          element(document, "p", "help", t("settings.utilityActionsHelp"))
        );
        const resetUtilityActions = element(
          document,
          "button",
          "positionButton",
          t("action.resetUtilityActions")
        );
        resetUtilityActions.type = "button";
        resetUtilityActions.disabled = busy;
        resetUtilityActions.addEventListener("click", async () => {
          await runOperation(async () => {
            await onUtilityActionsPositionReset?.();
            status = { message: t("status.utilityActionsReset"), tone: "success" };
          });
        });
        utilityPositionField.append(resetUtilityActions);
    
        form.append(
          languageSelect.field,
          scopeSelect.field,
          pageColor.field,
          composerColor.field,
          composerAppearance.field,
          launcherField,
          utilityPositionField
        );
    
        if (status) {
          const statusNode = element(document, "p", `status ${status.tone}`, status.message);
          statusNode.setAttribute("role", "status");
          form.append(statusNode);
        }
    
        const primaryActions = element(document, "div", "primaryActions");
        const save = element(document, "button", "primaryButton", t("action.save"));
        save.type = "button";
        save.disabled = busy;
        save.addEventListener("click", async () => {
          await runOperation(async () => {
            const nextPageColor = pageColor.text.value.trim();
            const nextComposerColor = composerColor.text.value.trim();
            const nextComposerAppearance = composerAppearance.select.value;
            await onSave({
              language: languageSelect.select.value,
              scope: scopeSelect.select.value,
              pageColor: nextPageColor,
              composerColor: nextComposerColor,
              composerAppearance: nextComposerAppearance,
              pageChanged: !sameColor(nextPageColor, model.pageColor),
              composerChanged: !sameColor(nextComposerColor, model.composerColor),
              composerAppearanceChanged:
                nextComposerAppearance !== (model.composerAppearance ?? "solid")
            });
          });
        });
        primaryActions.append(save);
    
        const utilityActions = element(document, "div", "utilityActions");
        const exportButton = utilityButton(document, t("action.export"));
        const importButton = utilityButton(document, t("action.import"));
        const resetButton = utilityButton(document, t("action.reset"), "danger");
    
        exportButton.addEventListener("click", async () => {
          await runOperation(async () => {
            const text = await onExport();
            renderBackupEditor({ mode: "export", text });
          }, { rerender: false });
        });
    
        importButton.addEventListener("click", () => {
          renderBackupEditor({ mode: "import", text: "" });
        });
    
        resetButton.addEventListener("click", async () => {
          if (!runtimeWindow.confirm(t("confirm.reset"))) return;
          await runOperation(async () => {
            await onReset();
          });
        });
    
        utilityActions.append(exportButton, importButton, resetButton);
        sheet.append(header, form, primaryActions, utilityActions);
    
        function createUpdateField() {
          const updateState = model.updateState;
          const available = Boolean(updateState?.available);
          const field = element(
            document,
            "section",
            `updateField${available ? " available" : ""}`
          );
          const heading = element(
            document,
            "div",
            "updateHeading",
            available ? t("update.availableTitle") : t("update.title")
          );
          field.append(heading);
    
          const versionText = available
            ? t("update.versionPair", {
                current: model.currentVersion,
                available: updateState.availableVersion
              })
            : t("update.currentVersion", { version: model.currentVersion });
          field.append(element(document, "p", "updateVersion", versionText));
    
          const actions = element(document, "div", "updateActions");
          const checkButton = element(
            document,
            "button",
            "updateCheckButton",
            t("action.checkUpdate")
          );
          checkButton.type = "button";
          checkButton.disabled = busy;
          checkButton.addEventListener("click", async () => {
            await runOperation(async () => {
              const nextState = await onCheckForUpdate?.();
              if (nextState) setUpdateState(nextState);
              if (nextState?.status === "error") {
                status = { message: t("error.updateCheckFailed"), tone: "error" };
              } else if (nextState?.available) {
                status = { message: t("status.updateAvailable"), tone: "success" };
              } else {
                status = { message: t("status.updateCurrent"), tone: "success" };
              }
            });
          });
          actions.append(checkButton);
    
          if (available) {
            const installButton = element(
              document,
              "button",
              "updateInstallButton",
              t("action.installUpdate")
            );
            installButton.type = "button";
            installButton.disabled = busy;
            installButton.addEventListener("click", () => {
              onInstallUpdate?.(updateState);
            });
            actions.append(installButton);
          }
    
          field.append(actions);
          return field;
        }
      }
    
      function renderBackupEditor({ mode, text }) {
        const { translator } = model;
        const t = translator.t;
        sheet.replaceChildren();
    
        const header = element(document, "header", "header");
        header.append(
          element(
            document,
            "h2",
            "title",
            t(mode === "export" ? "backup.exportTitle" : "backup.importTitle")
          )
        );
        const close = element(document, "button", "iconButton", "×");
        close.type = "button";
        close.setAttribute("aria-label", t("action.close"));
        close.addEventListener("click", renderEditor);
        header.append(close);
    
        const content = element(document, "div", "form");
        if (mode === "import") {
          content.append(element(document, "p", "help", t("backup.importHelp")));
        }
    
        const textarea = document.createElement("textarea");
        textarea.className = "backupText";
        textarea.value = text;
        textarea.readOnly = mode === "export";
        textarea.autocapitalize = "off";
        textarea.autocomplete = "off";
        textarea.spellcheck = false;
        content.append(textarea);
    
        const actions = element(document, "div", "primaryActions");
        const action = element(
          document,
          "button",
          "primaryButton",
          t(mode === "export" ? "action.copy" : "action.applyImport")
        );
        action.type = "button";
        action.addEventListener("click", async () => {
          if (mode === "export") {
            await copyText(textarea.value, textarea);
            setStatus(t("status.copied"));
            renderEditor();
            return;
          }
    
          await runOperation(async () => {
            await onImport(textarea.value);
          });
        });
        actions.append(action);
        sheet.append(header, content, actions);
        textarea.focus();
        if (mode === "export") textarea.select();
      }
    
      async function copyText(text, textarea) {
        if (runtimeWindow.navigator?.clipboard?.writeText) {
          await runtimeWindow.navigator.clipboard.writeText(text);
          return;
        }
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
      }
    
      async function runOperation(operation, { rerender = true } = {}) {
        if (busy) return;
        busy = true;
        try {
          await operation();
        } catch (error) {
          console.error("[Room Layer]", error);
          setStatus(model.translator.t("error.operationFailed"), "error");
        } finally {
          busy = false;
          if (rerender && open) renderEditor();
        }
      }
    
      function destroy() {
        launcherController.destroy();
        host.remove();
      }
    
      return Object.freeze({
        render,
        open: () => setOpen(true),
        close: () => setOpen(false),
        setStatus,
        setUpdateState,
        setLauncherPosition: launcherController.setPosition,
        destroy
      });
    }
    
    function createSelectField({ document, label, value, options }) {
      const field = element(document, "label", "field");
      field.append(element(document, "span", "label", label));
      const select = document.createElement("select");
      select.className = "select";
      for (const [optionValue, optionLabel] of options) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionLabel;
        select.append(option);
      }
      select.value = value;
      field.append(select);
      return { field, select };
    }
    
    function createColorField({ document, label, value, fallback }) {
      const field = element(document, "label", "field");
      field.append(element(document, "span", "label", label));
      const row = element(document, "div", "colorRow");
      const picker = document.createElement("input");
      picker.className = "colorPicker";
      picker.type = "color";
      picker.value = normalizePickerColor(value, fallback);
      const text = document.createElement("input");
      text.className = "textInput";
      text.type = "text";
      text.value = value;
      text.autocapitalize = "off";
      text.autocomplete = "off";
      text.spellcheck = false;
      picker.addEventListener("input", () => {
        text.value = picker.value;
      });
      text.addEventListener("input", () => {
        if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) {
          picker.value = text.value.trim();
        }
      });
      row.append(picker, text);
      field.append(row);
      return { field, picker, text };
    }
    
    function utilityButton(document, label, extraClass = "") {
      const button = element(document, "button", `utilityButton ${extraClass}`, label);
      button.type = "button";
      return button;
    }
    
    function element(document, tagName, className, text = null) {
      const node = document.createElement(tagName);
      node.className = className;
      if (text !== null) node.textContent = text;
      return node;
    }
    
    function sameColor(left, right) {
      return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
    }
    
    function normalizePickerColor(value, fallback) {
      if (/^#[0-9a-f]{6}$/i.test(value)) return value;
      if (/^#[0-9a-f]{3}$/i.test(value)) {
        return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
      }
      return fallback;
    }
    
    function createStyle(document) {
      const style = document.createElement("style");
      style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button, input, select, textarea { font: inherit; }
    .launcher {
      position: fixed; right: 16px; bottom: calc(118px + env(safe-area-inset-bottom));
      z-index: 2147483645; width: 44px; height: 44px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,.28); background: rgba(28,24,34,.94);
      color: white; font-size: 20px; box-shadow: 0 8px 28px rgba(0,0,0,.38);
      -webkit-tap-highlight-color: transparent; touch-action: none; user-select: none;
      cursor: grab;
    }
    .launcher:active { cursor: grabbing; }
    .launcherBadge {
      position: absolute; top: -3px; right: -3px; width: 13px; height: 13px;
      border: 2px solid #211d27; border-radius: 50%; background: #ff4f68;
      box-shadow: 0 2px 8px rgba(255,79,104,.55); pointer-events: none;
    }
    .launcherBadge[hidden] { display: none; }
    .overlay {
      position: fixed; inset: 0; z-index: 2147483646; display: flex;
      align-items: flex-end; justify-content: center; padding: 16px 12px 0;
      background: rgba(0,0,0,.42); backdrop-filter: blur(4px);
    }
    .overlay[hidden] { display: none; }
    .sheet {
      width: min(100%, 520px); max-height: min(82vh, 720px); overflow: auto;
      padding: 18px 18px calc(18px + env(safe-area-inset-bottom));
      border-radius: 24px 24px 0 0; color: #f8f5fb; background: #211d27;
      border: 1px solid rgba(255,255,255,.12); box-shadow: 0 -18px 60px rgba(0,0,0,.38);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .title { margin: 0; font-size: 19px; font-weight: 700; }
    .iconButton {
      width: 38px; height: 38px; border: 0; border-radius: 50%; color: #f8f5fb;
      background: rgba(255,255,255,.08); font-size: 26px; line-height: 1;
    }
    .form { display: grid; gap: 16px; margin-top: 18px; }
    .field { display: grid; gap: 8px; }
    .label { color: #d8d0df; font-size: 13px; font-weight: 650; }
    .select, .textInput, .backupText {
      width: 100%; border: 1px solid rgba(255,255,255,.14); border-radius: 13px;
      background: #302a38; color: #fff; outline: none;
    }
    .select, .textInput { min-height: 46px; padding: 0 13px; }
    .select:focus, .textInput:focus, .backupText:focus { border-color: #a98cf5; }
    .colorRow { display: grid; grid-template-columns: 58px 1fr; gap: 10px; }
    .colorPicker { width: 58px; height: 46px; padding: 3px; border: 0; border-radius: 13px; background: #302a38; }
    .updateField {
      display: grid; gap: 9px; padding: 13px; border: 1px solid rgba(255,255,255,.1);
      border-radius: 14px; background: rgba(255,255,255,.035);
    }
    .updateField.available {
      border-color: rgba(255,79,104,.45); background: rgba(255,79,104,.08);
    }
    .updateHeading { color: #f5eff8; font-size: 14px; font-weight: 750; }
    .updateVersion { margin: 0; color: #c8bfce; font-size: 12px; line-height: 1.45; }
    .updateActions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .updateCheckButton, .updateInstallButton {
      min-height: 40px; padding: 8px; border-radius: 12px; font-size: 13px; font-weight: 700;
    }
    .updateCheckButton {
      border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: #eee8f3;
    }
    .updateInstallButton { border: 0; background: #ff4f68; color: white; }
    .updateCheckButton:disabled, .updateInstallButton:disabled { opacity: .55; }
    .positionField {
      display: grid; gap: 8px; padding: 13px; border: 1px solid rgba(255,255,255,.1);
      border-radius: 14px; background: rgba(255,255,255,.035);
    }
    .positionField .help { margin: 0; }
    .positionButton {
      min-height: 40px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
      background: rgba(255,255,255,.06); color: #eee8f3; font-size: 13px; font-weight: 650;
    }
    .primaryActions { display: grid; margin-top: 18px; }
    .primaryButton {
      min-height: 48px; border: 0; border-radius: 14px; background: #8b6ee8;
      color: white; font-weight: 750;
    }
    .primaryButton:disabled, .positionButton:disabled { opacity: .55; }
    .utilityActions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
    .utilityButton {
      min-height: 42px; padding: 8px; border: 1px solid rgba(255,255,255,.12);
      border-radius: 12px; background: rgba(255,255,255,.06); color: #eee8f3;
      font-size: 12px; font-weight: 650;
    }
    .utilityButton.danger { color: #ffb2b2; }
    .status { margin: 0; padding: 10px 12px; border-radius: 12px; font-size: 13px; }
    .status.success { background: rgba(96,211,148,.13); color: #b8f3d0; }
    .status.error { background: rgba(255,104,104,.13); color: #ffc0c0; }
    .help { margin: 0; color: #c8bfce; font-size: 13px; line-height: 1.5; }
    .backupText { min-height: 280px; padding: 12px; resize: vertical; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
    `;
      return style;
    }
    return { createSettingsPanel };
  })();
  __modules["src/ui/utility-actions.js"] = (() => {
    const { DEFAULT_UTILITY_ACTIONS_POSITION, createUtilityActionsPositionController } = __modules["src/ui/utility-actions-position.js"];
    
    const UTILITY_ACTIONS_HOST_ID = "chatgpt-layer-product-utility-actions";
    
    function createUtilityActions({
      document,
      window,
      position = DEFAULT_UTILITY_ACTIONS_POSITION,
      onPositionChange,
      onScrollToBottom,
      onReload,
      onSwitchTab
    }) {
      if (!document?.body || typeof document.createElement !== "function") {
        throw new TypeError("Utility actions require a browser document.");
      }
    
      removeExistingUtilityActionHosts(document);
    
      const runtimeWindow = window ?? globalThis;
      const host = document.createElement("div");
      host.id = UTILITY_ACTIONS_HOST_ID;
      const shadow = host.attachShadow({ mode: "open" });
      shadow.append(createStyle(document));
    
      const bar = document.createElement("div");
      bar.className = "bar";
    
      const scrollButton = createActionButton(document, "↓");
      const reloadButton = createActionButton(document, "↻");
      const tabButton = createActionButton(document, "⇄");
      scrollButton.dataset.action = "scroll-to-bottom";
      reloadButton.dataset.action = "reload";
      tabButton.dataset.action = "switch-tab";
    
      const toast = document.createElement("div");
      toast.className = "toast";
      toast.hidden = true;
      toast.setAttribute("role", "status");
    
      let translator = null;
      let tabNavigationState = "unknown";
      let switchBusy = false;
      let toastTimer = null;
    
      const handleScroll = () => onScrollToBottom?.();
      const handleReload = () => onReload?.();
      const handleSwitch = async () => {
        if (switchBusy || tabNavigationState !== "connected") return;
        switchBusy = true;
        updateTabButton();
        try {
          const result = await onSwitchTab?.();
          if (!result?.ok) showTabNavigationError(result?.code);
        } catch {
          showTabNavigationError("TAB_SWITCH_FAILED");
        } finally {
          switchBusy = false;
          updateTabButton();
        }
      };
    
      scrollButton.addEventListener("click", handleScroll);
      reloadButton.addEventListener("click", handleReload);
      tabButton.addEventListener("click", handleSwitch);
    
      bar.append(scrollButton, reloadButton, tabButton);
      shadow.append(bar, toast);
      document.body.append(host);
    
      const positionController = createUtilityActionsPositionController({
        element: bar,
        window: runtimeWindow,
        initialPosition: position,
        onPositionChange
      });
    
      function render(nextTranslator) {
        translator = nextTranslator;
        const t = translator?.t ?? ((key) => key);
        const scrollLabel = t("action.scrollToBottom");
        const reloadLabel = t("action.reload");
        scrollButton.setAttribute("aria-label", scrollLabel);
        scrollButton.title = scrollLabel;
        reloadButton.setAttribute("aria-label", reloadLabel);
        reloadButton.title = reloadLabel;
        updateTabButton();
      }
    
      function setTabNavigationState(nextState) {
        tabNavigationState = typeof nextState === "string" ? nextState : "error";
        updateTabButton();
      }
    
      function updateTabButton() {
        const t = translator?.t ?? ((key) => key);
        const labels = {
          unknown: t("status.tabNavigationConnecting"),
          connected: t("action.switchTab"),
          unavailable: t("error.tabNavigationUnavailable"),
          incompatible: t("error.tabNavigationIncompatible"),
          error: t("error.tabNavigationFailed")
        };
        const label = labels[tabNavigationState] ?? labels.error;
        tabButton.disabled = switchBusy || tabNavigationState !== "connected";
        tabButton.setAttribute("aria-label", label);
        tabButton.title = label;
        tabButton.dataset.state = tabNavigationState;
      }
    
      function showTabNavigationError(code) {
        const t = translator?.t ?? ((key) => key);
        const key = code === "NOT_ENOUGH_TABS"
          ? "error.tabNavigationNotEnoughTabs"
          : code === "TARGET_NOT_FOUND"
            ? "error.tabNavigationTargetNotFound"
            : code === "INCOMPATIBLE_PROTOCOL"
              ? "error.tabNavigationIncompatible"
              : code === "BRIDGE_TIMEOUT" || code === "BRIDGE_DESTROYED" || code === "BRIDGE_DISPATCH_FAILED"
                ? "error.tabNavigationUnavailable"
                : "error.tabNavigationFailed";
    
        toast.textContent = t(key);
        toast.hidden = false;
        if (toastTimer !== null) runtimeWindow.clearTimeout?.(toastTimer);
        toastTimer = runtimeWindow.setTimeout?.(() => {
          toast.hidden = true;
          toastTimer = null;
        }, 3200) ?? null;
      }
    
      function destroy() {
        positionController.destroy();
        if (toastTimer !== null) runtimeWindow.clearTimeout?.(toastTimer);
        scrollButton.removeEventListener("click", handleScroll);
        reloadButton.removeEventListener("click", handleReload);
        tabButton.removeEventListener("click", handleSwitch);
        host.remove();
      }
    
      return Object.freeze({
        host,
        render,
        setPosition: positionController.setPosition,
        setTabNavigationState,
        destroy
      });
    }
    
    function removeExistingUtilityActionHosts(document, activeHost = null) {
      const hosts = typeof document?.querySelectorAll === "function"
        ? [...document.querySelectorAll(`#${UTILITY_ACTIONS_HOST_ID}`)]
        : [document?.getElementById?.(UTILITY_ACTIONS_HOST_ID)].filter(Boolean);
    
      for (const host of hosts) {
        if (host !== activeHost) {
          host.remove?.();
        }
      }
    
      return hosts.length;
    }
    
    function createActionButton(document, icon) {
      const button = document.createElement("button");
      button.className = "action";
      button.type = "button";
      button.textContent = icon;
      return button;
    }
    
    function createStyle(document) {
      const style = document.createElement("style");
      style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button { font: inherit; }
    .bar {
      position: fixed;
      z-index: 2147483644;
      display: flex;
      gap: 8px;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      touch-action: none;
      user-select: none;
      cursor: grab;
    }
    .bar[data-cglp-dragging="on"] { cursor: grabbing; }
    .action {
      width: 42px;
      height: 42px;
      padding: 0;
      border: 1px solid rgba(255,255,255,.24);
      border-radius: 50%;
      background: rgba(28,24,34,.92);
      color: #f8f5fb;
      box-shadow: 0 7px 22px rgba(0,0,0,.32);
      font-size: 22px;
      font-weight: 700;
      line-height: 1;
      -webkit-tap-highlight-color: transparent;
      touch-action: none;
    }
    .bar[data-cglp-dragging="on"] .action {
      box-shadow: 0 3px 10px rgba(0,0,0,.25);
    }
    .action:active {
      transform: scale(.94);
      background: rgba(58,49,70,.96);
    }
    .action:disabled {
      opacity: .42;
      cursor: default;
    }
    .action[data-state="connected"] {
      border-color: rgba(173,255,239,.48);
    }
    .bar[data-cglp-dragging="on"] .action:active { transform: none; }
    .toast {
      position: fixed;
      z-index: 2147483645;
      left: 50%;
      bottom: 84px;
      transform: translateX(-50%);
      max-width: calc(100vw - 32px);
      padding: 9px 12px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 11px;
      background: rgba(36,30,42,.97);
      color: #fff;
      box-shadow: 0 7px 22px rgba(0,0,0,.34);
      font: 600 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: none;
    }
    .toast[hidden] { display: none; }
    `;
      return style;
    }
    return { UTILITY_ACTIONS_HOST_ID, createUtilityActions, removeExistingUtilityActionHosts };
  })();
  __modules["src/adapters/gear/text-request.js"] = (() => {
    const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
    
    function createGearTextRequester({
      legacyRequest = null,
      modernRequest = null,
      fetch = null,
      now = () => Date.now(),
      timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
    } = {}) {
      const transports = {
        legacyRequest: typeof legacyRequest === "function" ? legacyRequest : null,
        modernRequest: typeof modernRequest === "function" ? modernRequest : null,
        fetch: typeof fetch === "function" ? fetch : null
      };
    
      if (!transports.legacyRequest && !transports.modernRequest && !transports.fetch) {
        throw new TypeError("Gear text requester requires a network transport.");
      }
    
      async function requestText(url, { cacheBust = true } = {}) {
        if (typeof url !== "string" || url.length === 0) {
          throw new TypeError("Gear text requester requires a URL.");
        }
    
        const target = cacheBust ? appendCacheBust(url, now()) : url;
    
        if (transports.legacyRequest) {
          return requestWithUserscriptApi(transports.legacyRequest, target, timeoutMs);
        }
        if (transports.modernRequest) {
          return requestWithUserscriptApi(transports.modernRequest, target, timeoutMs);
        }
        return requestWithFetch(transports.fetch, target);
      }
    
      return Object.freeze({ requestText });
    }
    
    function requestWithUserscriptApi(request, url, timeoutMs) {
      return new Promise((resolve, reject) => {
        let settled = false;
    
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          callback(value);
        };
    
        const options = {
          method: "GET",
          url,
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
          },
          timeout: timeoutMs,
          onload(response) {
            try {
              finish(resolve, readSuccessfulResponse(response));
            } catch (error) {
              finish(reject, error);
            }
          },
          onerror() {
            finish(reject, new Error("update_metadata_network_error"));
          },
          ontimeout() {
            finish(reject, new Error("update_metadata_timeout"));
          },
          onabort() {
            finish(reject, new Error("update_metadata_aborted"));
          }
        };
    
        try {
          const result = request(options);
          if (result && typeof result.then === "function") {
            result.then(
              (response) => {
                try {
                  finish(resolve, readSuccessfulResponse(response));
                } catch (error) {
                  finish(reject, error);
                }
              },
              () => finish(reject, new Error("update_metadata_network_error"))
            );
          }
        } catch (error) {
          finish(
            reject,
            new Error(`update_metadata_request_failed:${String(error?.message ?? error)}`)
          );
        }
      });
    }
    
    async function requestWithFetch(fetch, url) {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "omit"
        });
    
        if (!response?.ok) {
          throw new Error(`update_metadata_http_${response?.status ?? "unknown"}`);
        }
        return response.text();
      } catch (error) {
        if (String(error?.message ?? error).startsWith("update_metadata_http_")) {
          throw error;
        }
        throw new Error(`update_metadata_network_error:${String(error?.message ?? error)}`);
      }
    }
    
    function readSuccessfulResponse(response) {
      const status = Number(response?.status);
      if (!Number.isFinite(status) || status < 200 || status >= 300) {
        throw new Error(`update_metadata_http_${Number.isFinite(status) ? status : "unknown"}`);
      }
    
      if (typeof response?.responseText === "string") {
        return response.responseText;
      }
      if (typeof response?.response === "string") {
        return response.response;
      }
      throw new Error("update_metadata_missing_body");
    }
    
    function appendCacheBust(url, timestamp) {
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}room_layer_update=${encodeURIComponent(String(timestamp))}`;
    }
    return { DEFAULT_REQUEST_TIMEOUT_MS, createGearTextRequester };
  })();
  __modules["src/update/update-checker.js"] = (() => {
    const { createGearTextRequester } = __modules["src/adapters/gear/text-request.js"];
    
    const UPDATE_CHECK_CACHE_KEY =
      "chatgpt-layer-product:update-check:v1";
    const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
    
    function createUpdateChecker({
      backend,
      currentVersion,
      updateUrl,
      downloadUrl,
      requestText = null,
      fetch = globalThis.fetch,
      now = () => Date.now(),
      intervalMs = DEFAULT_UPDATE_CHECK_INTERVAL_MS
    }) {
      if (!backend || typeof backend.get !== "function" || typeof backend.set !== "function") {
        throw new TypeError("Update checker requires a storage backend.");
      }
      if (typeof currentVersion !== "string" || currentVersion.length === 0) {
        throw new TypeError("Update checker requires the installed version.");
      }
      if (typeof updateUrl !== "string" || typeof downloadUrl !== "string") {
        throw new TypeError("Update checker requires fixed update and download URLs.");
      }
    
      const readMetadata = resolveMetadataReader({ requestText, fetch });
    
      async function check({ force = false } = {}) {
        const checkedAt = Number(now());
    
        if (!force) {
          const cached = await loadCache(backend);
          if (
            cached &&
            checkedAt >= cached.checkedAt &&
            checkedAt - cached.checkedAt < intervalMs
          ) {
            return createResult({
              currentVersion,
              availableVersion: cached.availableVersion,
              checkedAt: cached.checkedAt,
              source: "cache",
              downloadUrl
            });
          }
        }
    
        try {
          const metadata = await readMetadata(updateUrl);
          const availableVersion = parseUserscriptVersion(metadata);
          if (!availableVersion) {
            throw new Error("update_metadata_missing_version");
          }
          if (!parseVersion(availableVersion)) {
            throw new Error("update_metadata_invalid_version");
          }
    
          await saveCache(backend, { availableVersion, checkedAt });
          return createResult({
            currentVersion,
            availableVersion,
            checkedAt,
            source: "network",
            downloadUrl
          });
        } catch (error) {
          return Object.freeze({
            status: "error",
            currentVersion,
            availableVersion: null,
            available: false,
            checkedAt,
            source: "network",
            downloadUrl,
            error: String(error?.message ?? error)
          });
        }
      }
    
      return Object.freeze({ check });
    }
    
    function parseUserscriptVersion(metadata) {
      if (typeof metadata !== "string") return null;
      const match = metadata.match(/^\s*\/\/\s*@version\s+([^\s]+)\s*$/m);
      return match?.[1] ?? null;
    }
    
    function compareVersions(left, right) {
      const leftVersion = parseVersion(left);
      const rightVersion = parseVersion(right);
      if (!leftVersion || !rightVersion) {
        throw new TypeError("Room Layer versions must use numeric semantic versions.");
      }
    
      const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length);
      for (let index = 0; index < coreLength; index += 1) {
        const leftPart = leftVersion.core[index] ?? 0;
        const rightPart = rightVersion.core[index] ?? 0;
        if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
      }
    
      if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) {
        return 0;
      }
      if (leftVersion.prerelease.length === 0) return 1;
      if (rightVersion.prerelease.length === 0) return -1;
    
      const length = Math.max(
        leftVersion.prerelease.length,
        rightVersion.prerelease.length
      );
      for (let index = 0; index < length; index += 1) {
        const leftPart = leftVersion.prerelease[index];
        const rightPart = rightVersion.prerelease[index];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        if (leftPart.value === rightPart.value && leftPart.numeric === rightPart.numeric) {
          continue;
        }
        if (leftPart.numeric && rightPart.numeric) {
          return leftPart.value < rightPart.value ? -1 : 1;
        }
        if (leftPart.numeric !== rightPart.numeric) {
          return leftPart.numeric ? -1 : 1;
        }
        return String(leftPart.value).localeCompare(String(rightPart.value));
      }
    
      return 0;
    }
    
    function isNewerVersion(currentVersion, availableVersion) {
      return compareVersions(currentVersion, availableVersion) < 0;
    }
    
    function resolveMetadataReader({ requestText, fetch }) {
      if (typeof requestText === "function") {
        return (url) => requestText(url, { cacheBust: true });
      }
    
      const legacyRequest =
        typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : null;
      const modernRequest =
        typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function"
          ? GM.xmlHttpRequest.bind(GM)
          : null;
    
      if (legacyRequest || modernRequest) {
        return createGearTextRequester({
          legacyRequest,
          modernRequest,
          fetch: typeof fetch === "function" ? fetch : null
        }).requestText;
      }
    
      if (typeof fetch !== "function") {
        throw new TypeError("Update checker requires a metadata request function.");
      }
    
      return async (url) => {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "omit"
        });
        if (!response?.ok) {
          throw new Error(`update_metadata_http_${response?.status ?? "unknown"}`);
        }
        return response.text();
      };
    }
    
    function createResult({
      currentVersion,
      availableVersion,
      checkedAt,
      source,
      downloadUrl
    }) {
      return Object.freeze({
        status: "ok",
        currentVersion,
        availableVersion,
        available: isNewerVersion(currentVersion, availableVersion),
        checkedAt,
        source,
        downloadUrl,
        error: null
      });
    }
    
    function parseVersion(value) {
      if (typeof value !== "string") return null;
      const match = value.trim().match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/);
      if (!match) return null;
    
      const core = match[1].split(".").map((part) => Number(part));
      if (core.some((part) => !Number.isSafeInteger(part) || part < 0)) {
        return null;
      }
    
      const prerelease = [];
      if (match[2]) {
        for (const segment of match[2].split(".")) {
          const tokens = segment.match(/[A-Za-z]+|\d+/g);
          if (!tokens || tokens.join("") !== segment) return null;
          for (const token of tokens) {
            const numeric = /^\d+$/.test(token);
            prerelease.push({
              numeric,
              value: numeric ? Number(token) : token.toLowerCase()
            });
          }
        }
      }
    
      return { core, prerelease };
    }
    
    async function loadCache(backend) {
      const text = await backend.get(UPDATE_CHECK_CACHE_KEY);
      if (typeof text !== "string" || text.length === 0) return null;
    
      try {
        const document = JSON.parse(text);
        if (
          document?.version !== 1 ||
          typeof document.availableVersion !== "string" ||
          !Number.isFinite(document.checkedAt)
        ) {
          return null;
        }
        if (!parseVersion(document.availableVersion)) return null;
        return {
          availableVersion: document.availableVersion,
          checkedAt: document.checkedAt
        };
      } catch {
        return null;
      }
    }
    
    async function saveCache(backend, { availableVersion, checkedAt }) {
      await backend.set(
        UPDATE_CHECK_CACHE_KEY,
        JSON.stringify({
          version: 1,
          availableVersion,
          checkedAt
        })
      );
    }
    return { UPDATE_CHECK_CACHE_KEY, DEFAULT_UPDATE_CHECK_INTERVAL_MS, createUpdateChecker, parseUserscriptVersion, compareVersions, isNewerVersion };
  })();
  __modules["src/userscript/main.js"] = (() => {
    const { createGearStorageBackend } = __modules["src/adapters/gear/storage-backend.js"];
    const { createGearTabNavigationBridge } = __modules["src/adapters/gear/tab-navigation-bridge.js"];
    const { getAvailableAssignmentScopes, parseChatGptContext } = __modules["src/core/chatgpt-context.js"];
    const { PRODUCT_UI_HOST_ID, claimProductRuntime } = __modules["src/core/runtime-guard.js"];
    const { getEffectiveComposerAppearance, getEffectiveComposerBackground, getEffectivePageBackground, getPreferredScope, upsertComposerTheme, upsertPageBackground } = __modules["src/core/settings-editor.js"];
    const { createComposerBackgroundFeature } = __modules["src/features/composer-background.js"];
    const { reloadCurrentPage, scrollConversationToBottom } = __modules["src/features/conversation-actions.js"];
    const { createPageBackgroundFeature } = __modules["src/features/page-background.js"];
    const { createTranslator } = __modules["src/i18n/messages.js"];
    const { DEVELOPMENT_DOWNLOAD_URL, DEVELOPMENT_UPDATE_URL, DEVELOPMENT_VERSION } = __modules["src/product-identity.js"];
    const { createSettingsStore } = __modules["src/storage/settings-store.js"];
    const { createUiPreferencesStore } = __modules["src/storage/ui-preferences.js"];
    const { createSettingsPanel } = __modules["src/ui/settings-panel.js"];
    const { createUtilityActions } = __modules["src/ui/utility-actions.js"];
    const { createUpdateChecker } = __modules["src/update/update-checker.js"];
    
    const DEFAULT_PAGE_COLOR = "#171717";
    const DEFAULT_COMPOSER_COLOR = "#303030";
    const DEFAULT_COMPOSER_APPEARANCE = "solid";
    const NAVIGATION_POLL_MS = 600;
    
    async function bootstrap() {
      if (globalThis.top !== globalThis.self) return;
    
      const runtimeGuard = claimProductRuntime({ document });
      let context = parseChatGptContext(globalThis.location);
      if (!context.supported) {
        runtimeGuard.release();
        return;
      }
    
      const backend = createGearStorageBackend(getGearStorageOptions());
      const store = createSettingsStore({ backend });
      const uiPreferences = createUiPreferencesStore({ backend });
      const updateChecker = createProductUpdateChecker(backend);
      const tabNavigation = createGearTabNavigationBridge({
        document,
        window: globalThis
      });
      const [loadResult, launcherPosition, utilityActionsPosition] = await Promise.all([
        store.load(),
        uiPreferences.loadLauncherPosition(),
        uiPreferences.loadUtilityActionsPosition()
      ]);
    
      if (!runtimeGuard.isCurrent()) {
        tabNavigation.destroy();
        return;
      }
    
      let settings = loadResult.settings;
      let translator = createProductTranslator(settings.language);
      let selectedScope = getPreferredScope(context);
      let pageEditorColor = getPageEditorColor(settings, context);
      let composerEditorColor = getComposerEditorColor(settings, context);
      let composerEditorAppearance = getComposerEditorAppearance(settings, context);
      let updateState = createIdleUpdateState();
      let storageSyncGeneration = 0;
    
      const pageBackground = createPageBackgroundFeature({ document });
      const composerBackground = createComposerBackgroundFeature({ document });
      const utilityActions = createUtilityActions({
        document,
        window: globalThis,
        position: utilityActionsPosition,
        onPositionChange: (position) => uiPreferences.saveUtilityActionsPosition(position),
        onScrollToBottom: () => scrollConversationToBottom({
          document,
          window: globalThis
        }),
        onReload: () => reloadCurrentPage(globalThis.location),
        onSwitchTab: () => tabNavigation.switchNext()
      });
      const stopTabNavigationState = tabNavigation.subscribe((state) => {
        utilityActions.setTabNavigationState(state);
      });
      const panel = createSettingsPanel({
        document,
        window: globalThis,
        launcherPosition,
        onLauncherPositionChange: (position) => uiPreferences.saveLauncherPosition(position),
        onLauncherPositionReset: () => uiPreferences.resetLauncherPosition(),
        onUtilityActionsPositionReset: async () => {
          const nextPosition = await uiPreferences.resetUtilityActionsPosition();
          utilityActions.setPosition(nextPosition);
          return nextPosition;
        },
        onCheckForUpdate: () => refreshUpdateState({ force: true }),
        onInstallUpdate: () => panel.setStatus(
          translator.t("update.nativeUpdateHelp"),
          "success"
        ),
        onSave: saveFromPanel,
        onExport: () => store.exportToJson(),
        onImport: importFromPanel,
        onReset: resetFromPanel
      });
    
      const uiHost = document.getElementById(PRODUCT_UI_HOST_ID);
      if (!runtimeGuard.isCurrent() || !uiHost) {
        stopTabNavigationState();
        tabNavigation.destroy();
        utilityActions.destroy();
        panel.destroy();
        pageBackground.clear();
        composerBackground.destroy();
        return;
      }
      runtimeGuard.watchUiHost(uiHost, globalThis.MutationObserver);
    
      applyCurrentTheme();
      renderPanel();
      void refreshUpdateState();
      void tabNavigation.ping();
    
      if (loadResult.recovered) {
        panel.setStatus(translator.t("status.recovered"));
      }
    
      const stopNavigationWatcher = watchNavigation((nextContext) => {
        context = nextContext;
        const availableScopes = getAvailableAssignmentScopes(context);
        if (!availableScopes.includes(selectedScope)) {
          selectedScope = getPreferredScope(context);
        }
        refreshEditorTheme();
        applyCurrentTheme();
        renderPanel();
      });
    
      const handleVisibilityChange = () => {
        if (document.visibilityState !== "visible") return;
        void syncFromStorage();
        if (tabNavigation.getState() !== "connected") {
          void tabNavigation.ping();
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
    
      globalThis.addEventListener("pagehide", (event) => {
        if (event.persisted) return;
        stopNavigationWatcher();
        stopTabNavigationState();
        tabNavigation.destroy();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        pageBackground.clear();
        composerBackground.destroy();
        utilityActions.destroy();
        panel.destroy();
        runtimeGuard.release();
      }, { once: true });
    
      async function syncFromStorage() {
        const syncGeneration = ++storageSyncGeneration;
        const nextContext = parseChatGptContext(globalThis.location);
        if (!nextContext.supported) return;
    
        const nextLoadResult = await store.load();
        if (
          syncGeneration !== storageSyncGeneration ||
          !runtimeGuard.isCurrent() ||
          document.visibilityState === "hidden"
        ) {
          return;
        }
    
        context = nextContext;
        settings = nextLoadResult.settings;
        translator = createProductTranslator(settings.language);
        const availableScopes = getAvailableAssignmentScopes(context);
        if (!availableScopes.includes(selectedScope)) {
          selectedScope = getPreferredScope(context);
        }
        refreshEditorTheme();
        applyCurrentTheme();
        renderPanel();
    
        if (nextLoadResult.recovered) {
          panel.setStatus(translator.t("status.recovered"));
        }
      }
    
      async function refreshUpdateState({ force = false } = {}) {
        if (!updateChecker) {
          updateState = createUpdateErrorState("request_unavailable");
          panel.setUpdateState(updateState);
          return updateState;
        }
    
        const nextState = await updateChecker.check({ force });
        if (!runtimeGuard.isCurrent()) return nextState;
        updateState = nextState;
        panel.setUpdateState(updateState);
        return updateState;
      }
    
      async function saveFromPanel({
        language,
        scope,
        pageColor,
        composerColor,
        composerAppearance,
        pageChanged,
        composerChanged,
        composerAppearanceChanged
      }) {
        storageSyncGeneration += 1;
        const latestLoadResult = await store.load();
        if (!runtimeGuard.isCurrent()) return;
    
        const draft = clone(latestLoadResult.settings);
        draft.language = language;
        const nextTranslator = createProductTranslator(language);
        const layerName = nextTranslator.t(`scope.${scope}`);
        let nextSettings = draft;
    
        if (pageChanged) {
          nextSettings = upsertPageBackground(nextSettings, {
            scope,
            context,
            color: pageColor,
            layerName
          });
        }
    
        if (composerChanged || composerAppearanceChanged) {
          nextSettings = upsertComposerTheme(nextSettings, {
            scope,
            context,
            color: composerColor,
            appearance: composerAppearance,
            layerName
          });
        }
    
        settings = await store.save(nextSettings);
        translator = nextTranslator;
        selectedScope = scope;
        refreshEditorTheme();
        applyCurrentTheme();
        renderPanel();
        panel.setStatus(translator.t("status.saved"));
      }
    
      async function importFromPanel(jsonText) {
        storageSyncGeneration += 1;
        settings = await store.importFromJson(jsonText);
        translator = createProductTranslator(settings.language);
        selectedScope = getPreferredScope(context);
        refreshEditorTheme();
        applyCurrentTheme();
        renderPanel();
        panel.setStatus(translator.t("status.imported"));
      }
    
      async function resetFromPanel() {
        storageSyncGeneration += 1;
        const [resetSettings, resetPositions] = await Promise.all([
          store.reset(),
          uiPreferences.resetAllPositions()
        ]);
        settings = resetSettings;
        translator = createProductTranslator(settings.language);
        selectedScope = getPreferredScope(context);
        pageEditorColor = DEFAULT_PAGE_COLOR;
        composerEditorColor = DEFAULT_COMPOSER_COLOR;
        composerEditorAppearance = DEFAULT_COMPOSER_APPEARANCE;
        panel.setLauncherPosition(resetPositions.launcher);
        utilityActions.setPosition(resetPositions.utilityActions);
        applyCurrentTheme();
        renderPanel();
        panel.setStatus(translator.t("status.reset"));
      }
    
      function refreshEditorTheme() {
        pageEditorColor = getPageEditorColor(settings, context);
        composerEditorColor = getComposerEditorColor(settings, context);
        composerEditorAppearance = getComposerEditorAppearance(settings, context);
      }
    
      function applyCurrentTheme() {
        const pageColor = getEffectivePageBackground(settings, context, null);
        if (pageColor) pageBackground.apply(pageColor);
        else pageBackground.clear();
    
        const composerColor = getEffectiveComposerBackground(settings, context, null);
        const composerAppearance = getEffectiveComposerAppearance(
          settings,
          context,
          DEFAULT_COMPOSER_APPEARANCE
        );
        if (composerColor) composerBackground.apply(composerColor, composerAppearance);
        else composerBackground.clear();
      }
    
      function renderPanel() {
        panel.render({
          translator,
          context,
          availableScopes: getAvailableAssignmentScopes(context),
          scope: selectedScope,
          pageColor: pageEditorColor,
          composerColor: composerEditorColor,
          composerAppearance: composerEditorAppearance,
          language: settings.language,
          currentVersion: DEVELOPMENT_VERSION,
          updateState
        });
        utilityActions.render(translator);
      }
    }
    
    function createProductUpdateChecker(backend) {
      try {
        return createUpdateChecker({
          backend,
          currentVersion: DEVELOPMENT_VERSION,
          updateUrl: DEVELOPMENT_UPDATE_URL,
          downloadUrl: DEVELOPMENT_DOWNLOAD_URL,
          fetch: typeof globalThis.fetch === "function"
            ? globalThis.fetch.bind(globalThis)
            : null
        });
      } catch {
        return null;
      }
    }
    
    function createIdleUpdateState() {
      return Object.freeze({
        status: "idle",
        currentVersion: DEVELOPMENT_VERSION,
        availableVersion: null,
        available: false,
        checkedAt: null,
        source: null,
        downloadUrl: DEVELOPMENT_DOWNLOAD_URL,
        error: null
      });
    }
    
    function createUpdateErrorState(error) {
      return Object.freeze({
        status: "error",
        currentVersion: DEVELOPMENT_VERSION,
        availableVersion: null,
        available: false,
        checkedAt: Date.now(),
        source: "runtime",
        downloadUrl: DEVELOPMENT_DOWNLOAD_URL,
        error
      });
    }
    
    function getGearStorageOptions() {
      const options = { scope: globalThis };
    
      if (
        typeof GM_getValue === "function" &&
        typeof GM_setValue === "function" &&
        typeof GM_deleteValue === "function"
      ) {
        options.getValue = GM_getValue;
        options.setValue = GM_setValue;
        options.deleteValue = GM_deleteValue;
        return options;
      }
    
      if (
        typeof GM !== "undefined" &&
        GM &&
        typeof GM.getValue === "function" &&
        typeof GM.setValue === "function" &&
        typeof GM.deleteValue === "function"
      ) {
        options.getValue = GM.getValue.bind(GM);
        options.setValue = GM.setValue.bind(GM);
        options.deleteValue = GM.deleteValue.bind(GM);
      }
    
      return options;
    }
    
    function createProductTranslator(language) {
      return createTranslator({
        language,
        navigatorLanguages: globalThis.navigator?.languages ?? [globalThis.navigator?.language]
      });
    }
    
    function getPageEditorColor(settings, context) {
      return getEffectivePageBackground(settings, context, DEFAULT_PAGE_COLOR);
    }
    
    function getComposerEditorColor(settings, context) {
      return getEffectiveComposerBackground(settings, context, DEFAULT_COMPOSER_COLOR);
    }
    
    function getComposerEditorAppearance(settings, context) {
      return getEffectiveComposerAppearance(
        settings,
        context,
        DEFAULT_COMPOSER_APPEARANCE
      );
    }
    
    function watchNavigation(onChange) {
      let previousHref = globalThis.location.href;
    
      const check = () => {
        const nextHref = globalThis.location.href;
        if (nextHref === previousHref) return;
        previousHref = nextHref;
        const nextContext = parseChatGptContext(globalThis.location);
        if (nextContext.supported) onChange(nextContext);
      };
    
      const timer = globalThis.setInterval(check, NAVIGATION_POLL_MS);
      globalThis.addEventListener("popstate", check);
    
      return () => {
        globalThis.clearInterval(timer);
        globalThis.removeEventListener("popstate", check);
      };
    }
    
    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }
    
    void bootstrap().catch((error) => {
      console.error("[Room Layer] bootstrap failed", error);
    });
    return {};
  })();
})();
