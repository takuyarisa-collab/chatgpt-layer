# Gear Install Flow PoC

This experiment validates only the installation route. It does not contain ChatGPT Layer product features.

## Target flow

```text
Open link in Gear
→ Gear recognizes a UserScript
→ Confirm installation
→ Open or reload ChatGPT
→ See “ChatGPT Layer: Install OK” for five seconds
```

## Install links

### Primary: Raw GitHub

[Install test UserScript](https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/product-install-poc/product-install-poc/install-test.user.js)

### Fallback: jsDelivr

[Install test UserScript through jsDelivr](https://cdn.jsdelivr.net/gh/takuyarisa-collab/chatgpt-layer@product-install-poc/product-install-poc/install-test.user.js)

## Success criteria

- No ZIP download
- No Files app extraction
- No manual file import
- The install prompt opens from one tap
- The installed script runs after ChatGPT is opened or reloaded

## Cleanup

Delete or disable `ChatGPT Layer Install Test` after the experiment.
