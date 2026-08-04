# Desk Surface

ChatGPT Layer v0.11.0で追加したcomposer外装です。

## Structure

```text
Desk Surface
└─ Desk Mat
   └─ ChatGPT Composer
```

固定エンジンは表示中・操作可能なcomposerを検出し、既存ノードを複製せず次の属性を持つwrapperへ移します。

```html
<div data-chatgpt-layer-desk-surface="on">
  <div data-chatgpt-layer-desk-mat="on">
    <div
      data-chatgpt-layer-composer-slot="on"
      data-chatgpt-layer-composer-surface="desk"
    >
      <!-- ChatGPT composer -->
    </div>
  </div>
</div>
```

## Configuration

```json
{
  "theme": {
    "composerBackground": "#443943",
    "composerStyle": {
      "enabled": false
    },
    "deskSurface": {
      "enabled": true,
      "background": "#38252d",
      "padding": 6,
      "radius": 28,
      "gradient": {
        "enabled": true,
        "angle": 180,
        "from": "#4a3035",
        "to": "#2e2029"
      },
      "shadow": {
        "enabled": true,
        "color": "rgba(7, 3, 8, 0.48)",
        "x": 0,
        "y": 12,
        "blur": 36,
        "spread": -11
      },
      "highlight": {
        "enabled": true,
        "color": "rgba(255, 225, 214, 0.11)",
        "size": 1
      },
      "texture": {
        "enabled": true,
        "type": "wood",
        "color": "rgba(244, 178, 145, 0.28)",
        "size": 7,
        "blendMode": "normal"
      }
    },
    "deskMat": {
      "enabled": true,
      "background": "#5a5360",
      "padding": 3,
      "radius": 22,
      "borderSize": 1,
      "borderColor": "rgba(255, 245, 252, 0.08)",
      "shadow": {
        "enabled": true,
        "color": "rgba(0, 0, 0, 0.18)",
        "x": 0,
        "y": 1,
        "blur": 3,
        "spread": 0
      }
    }
  }
}
```

`deskSurface.padding`がDesk SurfaceとDesk Matの間隔です。composerの高さが変わっても、この値の木目露出を維持します。`deskMat.padding`はマットとcomposerの間に見せる縁です。

## Lifecycle

- `MutationObserver`でChatGPTの再描画を監視
- `ResizeObserver`でcomposerの高さ変化を監視
- 同じcomposerが既に3層構造へ入っている場合は再生成しない
- composerが差し替えられた場合は古いwrapperを破棄し、新しいcomposerへ再適用
- Desk Surfaceを無効化した場合はcomposerを元のDOM位置へ戻し、変更前のinline styleを復元
- iframe内ではUserScriptを実行しない

## Backward compatibility

`deskSurface`と`deskMat`の両方が有効な場合は3層構造を優先します。設定がないレイヤーでは従来の`composerStyle`がそのまま動作します。
