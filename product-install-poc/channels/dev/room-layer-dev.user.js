// ==UserScript==
// @name         Room Layer Dev
// @name:en      Room Layer Dev
// @name:ja      Room Layer 開発版
// @namespace    https://github.com/takuyarisa-collab/chatgpt-layer-product
// @version      0.3.0-dev3
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
        normalized.composer = { background: theme.composer.background };
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
        validateSurfaceTheme(theme.page, `${path}.page`, "Page", errors);
      }
      if (hasComposer) {
        validateSurfaceTheme(theme.composer, `${path}.composer`, "Composer", errors);
      }
    }
    
    function validateSurfaceTheme(surface, path, label, errors) {
      if (!isPlainObject(surface)) {
        addError(errors, path, "invalid_type", `${label} theme must be a plain object.`);
        return;
      }
    
      rejectUnknownKeys(surface, ["background"], path, errors);
    
      if (typeof surface.background !== "string" || !HEX_COLOR_PATTERN.test(surface.background)) {
        addError(errors, `${path}.background`, "invalid_color", "Background must be #RGB, #RRGGBB, or #RRGGBBAA.");
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
    return { SETTINGS_FORMAT, SCHEMA_VERSION, SUPPORTED_LANGUAGES, SCHEMA_LIMITS, SettingsValidationError, createDefaultSettings, validateSettings, normalizeSettings };
  })();
  __modules["src/core/settings-editor.js"] = (() => {
    const { normalizeSettings } = __modules["src/core/schema-v1.js"];
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
      return upsertSurfaceBackground(settings, "composer", options);
    }
    
    function getEffectivePageBackground(settings, context, fallback = DEFAULT_PAGE_BACKGROUND) {
      return getEffectiveSurfaceBackground(settings, context, "page", fallback);
    }
    
    function getEffectiveComposerBackground(settings, context, fallback = DEFAULT_COMPOSER_BACKGROUND) {
      return getEffectiveSurfaceBackground(settings, context, "composer", fallback);
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
        theme.composer = { background: color };
      }
    
      next.layers[layerId] = {
        name: normalizeLayerName(layerName ?? existingLayer?.name, scope),
        enabled: true,
        theme
      };
    
      const assignment = getAssignmentArray(next.assignments, target);
      const withoutManagedLayer = assignment.filter((id) => id !== layerId);
      withoutManagedLayer.push(layerId);
      setAssignmentArray(next.assignments, target, withoutManagedLayer);
    
      return normalizeSettings(next);
    }
    
    function getEffectiveSurfaceBackground(settings, context, surface, fallback) {
      const normalized = normalizeSettings(settings);
      const layerIds = resolveAssignedLayerIds(normalized.assignments, context);
      let background = fallback;
    
      for (const layerId of layerIds) {
        const layer = normalized.layers[layerId];
        const candidate = surface === "page"
          ? layer?.theme?.page?.background
          : layer?.theme?.composer?.background;
        if (layer?.enabled && candidate) background = candidate;
      }
    
      return background;
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
    return { SettingsEditError, upsertPageBackground, upsertComposerBackground, getEffectivePageBackground, getEffectiveComposerBackground, getPreferredScope, buildManagedLayerId };
  })();
  __modules["src/features/composer-background.js"] = (() => {
    const ROOT_ATTRIBUTE = "data-chatgpt-layer-product-composer-theme";
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
      '[data-testid*="composer"]'
    ].join(", ");
    
    function createComposerBackgroundFeature({
      document,
      MutationObserver = globalThis.MutationObserver,
      getComputedStyle = globalThis.getComputedStyle
    }) {
      if (!document?.head || !document?.body || typeof document.querySelector !== "function") {
        throw new TypeError("Composer background feature requires a browser document.");
      }
    
      const originals = new WeakMap();
      let activeColor = null;
      let activeSurface = null;
      let observer = null;
    
      function apply(color) {
        activeColor = color;
        ensureStyle(document);
        startObserver();
        refresh();
      }
    
      function refresh() {
        if (!activeColor) return;
    
        const nextSurface = findComposerSurface(document, getComputedStyle);
        if (nextSurface !== activeSurface) {
          restoreSurface(activeSurface);
          activeSurface = nextSurface;
        }
    
        if (activeSurface) {
          decorateSurface(activeSurface, activeColor);
        }
      }
    
      function clear() {
        activeColor = null;
        stopObserver();
        restoreSurface(activeSurface);
        activeSurface = null;
      }
    
      function destroy() {
        clear();
      }
    
      function startObserver() {
        if (observer || typeof MutationObserver !== "function") return;
        observer = new MutationObserver(refresh);
        observer.observe(document.body, { childList: true, subtree: true });
      }
    
      function stopObserver() {
        observer?.disconnect();
        observer = null;
      }
    
      function decorateSurface(surface, color) {
        if (!originals.has(surface)) {
          originals.set(surface, {
            attribute: surface.getAttribute?.(ROOT_ATTRIBUTE) ?? null,
            color: surface.style?.getPropertyValue?.(COLOR_PROPERTY) ?? ""
          });
        }
    
        surface.setAttribute?.(ROOT_ATTRIBUTE, "on");
        surface.style?.setProperty?.(COLOR_PROPERTY, color);
      }
    
      function restoreSurface(surface) {
        if (!surface) return;
        const original = originals.get(surface);
        if (!original) return;
    
        if (original.attribute === null) {
          surface.removeAttribute?.(ROOT_ATTRIBUTE);
        } else {
          surface.setAttribute?.(ROOT_ATTRIBUTE, original.attribute);
        }
    
        if (original.color) {
          surface.style?.setProperty?.(COLOR_PROPERTY, original.color);
        } else {
          surface.style?.removeProperty?.(COLOR_PROPERTY);
        }
    
        originals.delete(surface);
      }
    
      return Object.freeze({ apply, refresh, clear, destroy });
    }
    
    function findComposerSurface(document, getComputedStyle = globalThis.getComputedStyle) {
      const editor = document.querySelector(EDITOR_SELECTOR);
      if (!editor) return null;
    
      const explicit = editor.closest?.(EXPLICIT_SURFACE_SELECTOR);
      if (explicit) return explicit;
    
      const ancestors = [];
      let current = editor.parentElement;
      for (let depth = 0; current && depth < 10; depth += 1) {
        ancestors.push(current);
        if (String(current.tagName).toLowerCase() === "form") break;
        current = current.parentElement;
      }
    
      if (typeof getComputedStyle === "function") {
        const styled = ancestors.find((candidate) => isSurfaceLike(candidate, getComputedStyle));
        if (styled) return styled;
      }
    
      return editor.closest?.("form") ?? ancestors.at(-1) ?? editor.parentElement ?? null;
    }
    
    function isSurfaceLike(element, getComputedStyle) {
      try {
        const style = getComputedStyle(element);
        const backgroundColor = style?.backgroundColor ?? "";
        const backgroundImage = style?.backgroundImage ?? "";
        const borderRadius = Number.parseFloat(style?.borderRadius ?? "0");
        const hasBackground =
          (backgroundColor && backgroundColor !== "transparent" && backgroundColor !== "rgba(0, 0, 0, 0)") ||
          (backgroundImage && backgroundImage !== "none");
        return hasBackground || borderRadius >= 8;
      } catch {
        return false;
      }
    }
    
    function ensureStyle(document) {
      if (document.getElementById(STYLE_ID)) return;
    
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
    [${ROOT_ATTRIBUTE}="on"] {
      --composer-surface-primary: var(${COLOR_PROPERTY}) !important;
      --composer-surface-secondary: var(${COLOR_PROPERTY}) !important;
      background: var(${COLOR_PROPERTY}) !important;
      background-color: var(${COLOR_PROPERTY}) !important;
    }
    `;
      document.head.append(style);
    }
    return { createComposerBackgroundFeature, findComposerSurface };
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
    return { PRODUCT_NAME, PUBLISHER_NAME, PRODUCT_URL, LEGACY_PRODUCT_NAME, PUBLIC_DISTRIBUTION_BASE_URL, DEVELOPMENT_SCRIPT_NAME, DEVELOPMENT_NAMESPACE, DEVELOPMENT_UPDATE_URL, DEVELOPMENT_DOWNLOAD_URL, PUBLIC_SCRIPT_NAME, PUBLIC_NAMESPACE, PUBLIC_UPDATE_URL, PUBLIC_DOWNLOAD_URL, PRODUCT_IDENTITY, UPDATE_CHANNELS };
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
        "settings.utilityActionsHelp": "Drag the ↓ / ↻ pair to move it. It snaps to the nearest edge.",
        "language.auto": "Device language",
        "language.en": "English",
        "language.ja": "Japanese",
        "scope.label": "Apply to",
        "scope.global": "All chats",
        "scope.project": "This project",
        "scope.chat": "This chat",
        "theme.pageBackground": "Page background",
        "theme.composerBackground": "Composer background",
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
        "status.saved": "Settings saved.",
        "status.imported": "Settings imported.",
        "status.reset": "Settings reset.",
        "status.launcherReset": "Button position reset.",
        "status.utilityActionsReset": "Quick-action position reset.",
        "status.copied": "Copied to the clipboard.",
        "status.recovered": "Settings were restored from a backup.",
        "confirm.reset": `Reset all ${PRODUCT_NAME} settings?`,
        "error.noProject": "This page is not inside a ChatGPT project.",
        "error.noChat": "Open a conversation before applying settings to this chat.",
        "error.storageUnavailable": "Gear storage is unavailable.",
        "error.invalidImport": "The selected backup is not valid.",
        "error.operationFailed": "The operation failed."
      }),
      ja: Object.freeze({
        "settings.title": `${PRODUCT_NAME} 設定`,
        "settings.language": "言語",
        "settings.launcher": "設定ボタン",
        "settings.launcherHelp": "画面上の設定ボタンをドラッグして移動できます。離すと左右の端へ吸着します。",
        "settings.utilityActions": "クイック操作",
        "settings.utilityActionsHelp": "↓／↻の2ボタンをまとめてドラッグできます。離すと左右の端へ吸着します。",
        "language.auto": "端末の言語",
        "language.en": "English",
        "language.ja": "日本語",
        "scope.label": "適用先",
        "scope.global": "すべてのチャット",
        "scope.project": "このプロジェクト",
        "scope.chat": "このチャット",
        "theme.pageBackground": "ページ背景",
        "theme.composerBackground": "入力欄の背景",
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
        "status.saved": "設定を保存しました。",
        "status.imported": "設定を読み込みました。",
        "status.reset": "設定をリセットしました。",
        "status.launcherReset": "設定ボタンの位置を初期化しました。",
        "status.utilityActionsReset": "クイック操作の位置を初期化しました。",
        "status.copied": "クリップボードへコピーしました。",
        "status.recovered": "バックアップから設定を復旧しました。",
        "confirm.reset": `${PRODUCT_NAME}の設定をすべてリセットしますか？`,
        "error.noProject": "このページはChatGPTプロジェクト内ではありません。",
        "error.noChat": "このチャットに適用するには会話を開いてください。",
        "error.storageUnavailable": "Gearの保存機能を利用できません。",
        "error.invalidImport": "選択したバックアップは有効ではありません。",
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
        launcher.setAttribute("aria-label", model.translator.t("settings.title"));
        launcher.title = model.translator.t("settings.title");
        if (open) renderEditor();
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
            await onSave({
              language: languageSelect.select.value,
              scope: scopeSelect.select.value,
              pageColor: nextPageColor,
              composerColor: nextComposerColor,
              pageChanged: !sameColor(nextPageColor, model.pageColor),
              composerChanged: !sameColor(nextComposerColor, model.composerColor)
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
          console.error("[ChatGPT Layer Product]", error);
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
      onReload
    }) {
      if (!document?.body || typeof document.createElement !== "function") {
        throw new TypeError("Utility actions require a browser document.");
      }
    
      removeExistingUtilityActionHosts(document);
    
      const host = document.createElement("div");
      host.id = UTILITY_ACTIONS_HOST_ID;
      const shadow = host.attachShadow({ mode: "open" });
      shadow.append(createStyle(document));
    
      const bar = document.createElement("div");
      bar.className = "bar";
    
      const scrollButton = createActionButton(document, "↓");
      const reloadButton = createActionButton(document, "↻");
      scrollButton.dataset.action = "scroll-to-bottom";
      reloadButton.dataset.action = "reload";
    
      const handleScroll = () => onScrollToBottom?.();
      const handleReload = () => onReload?.();
      scrollButton.addEventListener("click", handleScroll);
      reloadButton.addEventListener("click", handleReload);
    
      bar.append(scrollButton, reloadButton);
      shadow.append(bar);
      document.body.append(host);
    
      const positionController = createUtilityActionsPositionController({
        element: bar,
        window: window ?? globalThis,
        initialPosition: position,
        onPositionChange
      });
    
      function render(translator) {
        const t = translator?.t ?? ((key) => key);
        const scrollLabel = t("action.scrollToBottom");
        const reloadLabel = t("action.reload");
        scrollButton.setAttribute("aria-label", scrollLabel);
        scrollButton.title = scrollLabel;
        reloadButton.setAttribute("aria-label", reloadLabel);
        reloadButton.title = reloadLabel;
      }
    
      function destroy() {
        positionController.destroy();
        scrollButton.removeEventListener("click", handleScroll);
        reloadButton.removeEventListener("click", handleReload);
        host.remove();
      }
    
      return Object.freeze({
        host,
        render,
        setPosition: positionController.setPosition,
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
    .bar[data-cglp-dragging="on"] .action:active { transform: none; }
    `;
      return style;
    }
    return { UTILITY_ACTIONS_HOST_ID, createUtilityActions, removeExistingUtilityActionHosts };
  })();
  __modules["src/userscript/main.js"] = (() => {
    const { createGearStorageBackend } = __modules["src/adapters/gear/storage-backend.js"];
    const { getAvailableAssignmentScopes, parseChatGptContext } = __modules["src/core/chatgpt-context.js"];
    const { PRODUCT_UI_HOST_ID, claimProductRuntime } = __modules["src/core/runtime-guard.js"];
    const { getEffectiveComposerBackground, getEffectivePageBackground, getPreferredScope, upsertComposerBackground, upsertPageBackground } = __modules["src/core/settings-editor.js"];
    const { createComposerBackgroundFeature } = __modules["src/features/composer-background.js"];
    const { reloadCurrentPage, scrollConversationToBottom } = __modules["src/features/conversation-actions.js"];
    const { createPageBackgroundFeature } = __modules["src/features/page-background.js"];
    const { createTranslator } = __modules["src/i18n/messages.js"];
    const { createSettingsStore } = __modules["src/storage/settings-store.js"];
    const { createUiPreferencesStore } = __modules["src/storage/ui-preferences.js"];
    const { createSettingsPanel } = __modules["src/ui/settings-panel.js"];
    const { createUtilityActions } = __modules["src/ui/utility-actions.js"];
    
    const DEFAULT_PAGE_COLOR = "#171717";
    const DEFAULT_COMPOSER_COLOR = "#303030";
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
      const [loadResult, launcherPosition, utilityActionsPosition] = await Promise.all([
        store.load(),
        uiPreferences.loadLauncherPosition(),
        uiPreferences.loadUtilityActionsPosition()
      ]);
    
      if (!runtimeGuard.isCurrent()) return;
    
      let settings = loadResult.settings;
      let translator = createProductTranslator(settings.language);
      let selectedScope = getPreferredScope(context);
      let pageEditorColor = getPageEditorColor(settings, context);
      let composerEditorColor = getComposerEditorColor(settings, context);
    
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
        onReload: () => reloadCurrentPage(globalThis.location)
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
        onSave: saveFromPanel,
        onExport: () => store.exportToJson(),
        onImport: importFromPanel,
        onReset: resetFromPanel
      });
    
      const uiHost = document.getElementById(PRODUCT_UI_HOST_ID);
      if (!runtimeGuard.isCurrent() || !uiHost) {
        utilityActions.destroy();
        panel.destroy();
        pageBackground.clear();
        composerBackground.destroy();
        return;
      }
      runtimeGuard.watchUiHost(uiHost, globalThis.MutationObserver);
    
      applyCurrentTheme();
      renderPanel();
    
      if (loadResult.recovered) {
        panel.setStatus(translator.t("status.recovered"));
      }
    
      const stopNavigationWatcher = watchNavigation((nextContext) => {
        context = nextContext;
        const availableScopes = getAvailableAssignmentScopes(context);
        if (!availableScopes.includes(selectedScope)) {
          selectedScope = getPreferredScope(context);
        }
        refreshEditorColors();
        applyCurrentTheme();
        renderPanel();
      });
    
      globalThis.addEventListener("pagehide", (event) => {
        if (event.persisted) return;
        stopNavigationWatcher();
        pageBackground.clear();
        composerBackground.destroy();
        utilityActions.destroy();
        panel.destroy();
        runtimeGuard.release();
      }, { once: true });
    
      async function saveFromPanel({
        language,
        scope,
        pageColor,
        composerColor,
        pageChanged,
        composerChanged
      }) {
        const draft = clone(settings);
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
    
        if (composerChanged) {
          nextSettings = upsertComposerBackground(nextSettings, {
            scope,
            context,
            color: composerColor,
            layerName
          });
        }
    
        settings = await store.save(nextSettings);
        translator = nextTranslator;
        selectedScope = scope;
        refreshEditorColors();
        applyCurrentTheme();
        renderPanel();
        panel.setStatus(translator.t("status.saved"));
      }
    
      async function importFromPanel(jsonText) {
        settings = await store.importFromJson(jsonText);
        translator = createProductTranslator(settings.language);
        selectedScope = getPreferredScope(context);
        refreshEditorColors();
        applyCurrentTheme();
        renderPanel();
        panel.setStatus(translator.t("status.imported"));
      }
    
      async function resetFromPanel() {
        const [resetSettings, resetPositions] = await Promise.all([
          store.reset(),
          uiPreferences.resetAllPositions()
        ]);
        settings = resetSettings;
        translator = createProductTranslator(settings.language);
        selectedScope = getPreferredScope(context);
        pageEditorColor = DEFAULT_PAGE_COLOR;
        composerEditorColor = DEFAULT_COMPOSER_COLOR;
        panel.setLauncherPosition(resetPositions.launcher);
        utilityActions.setPosition(resetPositions.utilityActions);
        applyCurrentTheme();
        renderPanel();
        panel.setStatus(translator.t("status.reset"));
      }
    
      function refreshEditorColors() {
        pageEditorColor = getPageEditorColor(settings, context);
        composerEditorColor = getComposerEditorColor(settings, context);
      }
    
      function applyCurrentTheme() {
        const pageColor = getEffectivePageBackground(settings, context, null);
        if (pageColor) pageBackground.apply(pageColor);
        else pageBackground.clear();
    
        const composerColor = getEffectiveComposerBackground(settings, context, null);
        if (composerColor) composerBackground.apply(composerColor);
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
          language: settings.language
        });
        utilityActions.render(translator);
      }
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
      console.error("[ChatGPT Layer Product] bootstrap failed", error);
    });
    return {};
  })();
})();
