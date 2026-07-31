# ChatGPT Layer

ChatGPT Webをそのまま使いながら、共通設定・プロジェクト・個別チャットに応じて個人用レイヤーを重ねるUserscriptです。

会話、履歴、推論、ChatGPT Plusの利用枠はChatGPT側に残し、画面上の見た目、composer表現、ボタン、入力補助だけを追加します。

## Current status

現在の固定エンジンは次に対応しています。

- URLからChatGPTプロジェクトIDと個別チャットIDを取得
- `Global → Project → Chat` の順にレイヤー設定をマージ
- ChatGPT内の画面遷移時に自動で再判定
- 未登録ページでは `default` レイヤーを適用
- 現在のプロジェクト、チャット、適用レイヤーをHTML属性へ記録
- レイヤー設定に応じたテーマ適用
- composerの影、ハイライト、グラデーション、軽量テクスチャ
- レイヤーごとの独自アクションボタン
- 全画面共通のリロードボタンと最下部スクロールボタン
- GitHubから取得するJSON設定の検証と端末内キャッシュ

## Layer priority

判定とマージの順番は固定です。

```text
1. Global settings
2. Project layers
3. Chat layers
```

Brainプロジェクト内の特定チャットへShionレイヤーを指定した場合は、次の設定が順番に重なります。

```text
Global + Brain + Shion
```

ChatレイヤーはProjectレイヤーを置き換えず、その上へ追加・上書きされます。

## Configuration

```json
{
  "version": "2026-08-01.3",
  "global": {},
  "projects": {
    "g-p-6a47aadbce188191b178e125bd7c4e86": {
      "layer": "brain"
    }
  },
  "chats": {
    "CHAT_ID": {
      "layer": "shion"
    }
  },
  "layers": {
    "default": {},
    "brain": {},
    "shion": {
      "theme": {
        "enabled": true,
        "composerStyle": {
          "enabled": true
        }
      },
      "actions": []
    },
    "blank": {},
    "ui": {}
  }
}
```

- `global`：すべての画面へ共通適用する設定
- `projects`：プロジェクトIDごとに適用するレイヤー
- `chats`：チャットIDごとに追加適用するレイヤー
- `layers`：各レイヤーの実体

一つの対象へ複数レイヤーを指定する場合は、適用順に配列へ並べます。

```json
{
  "layers": ["brain", "shion"]
}
```

## Composer style

各レイヤーの`theme.composerStyle`で、入力欄を囲むcomposer表面へ奥行きと素材感を付けられます。

```json
{
  "theme": {
    "enabled": true,
    "composerBackground": "#4b3548",
    "composerStyle": {
      "enabled": true,
      "gradient": {
        "enabled": true,
        "angle": 180,
        "from": "#5a4255",
        "to": "#382536"
      },
      "shadow": {
        "enabled": true,
        "color": "rgba(7, 3, 9, 0.58)",
        "x": 0,
        "y": 14,
        "blur": 30,
        "spread": -9
      },
      "highlight": {
        "enabled": true,
        "color": "rgba(255, 244, 251, 0.17)",
        "size": 1
      },
      "texture": {
        "enabled": true,
        "type": "grain",
        "color": "rgba(255, 244, 252, 0.045)",
        "size": 5,
        "blendMode": "soft-light"
      }
    }
  }
}
```

### Composer fields

- `composerStyle.enabled`：`false`で特殊表現を停止し、通常の単色composerへ戻す
- `gradient`：表面の明暗。`angle`、`from`、`to`を指定
- `shadow`：外側の影。`x`、`y`、`blur`、`spread`、`color`を指定
- `highlight`：上端の薄い反射。`size`と`color`を指定
- `texture`：CSSグラデーションだけで生成する軽量パターン。画像ファイルは読み込まない

対応する`texture.type`は次の3種類です。

```text
grain  細かな粒状
linen  縦横の細線
wood   一方向の木目風
```

対応する`texture.blendMode`は次の5種類です。

```text
normal
soft-light
overlay
multiply
screen
```

色はCSSとして有効なカラーだけを採用します。数値は固定エンジン側で安全な範囲へ丸めます。任意のCSS文字列、外部画像URL、Data URLは受け付けません。

composerはChatGPTのDOMから入力欄に最も近い表面要素を検出し、専用属性を付けて装飾します。ChatGPT内で画面遷移や再描画が起きた場合も再検出します。

## Layer actions

各レイヤーへ`actions`配列を追加すると、そのレイヤーが有効な画面だけに独自ボタンを表示できます。

```json
{
  "actions": [
    {
      "id": "shiori",
      "label": "栞",
      "title": "入力欄へ「しおり」を入れる",
      "type": "insertPrompt",
      "text": "しおり",
      "mode": "empty",
      "order": 10,
      "style": {
        "background": "#795078",
        "color": "#fffafc",
        "borderColor": "rgba(255,244,252,0.88)",
        "size": 40,
        "fontSize": 16
      }
    }
  ]
}
```

### Action fields

- `id`：必須。英数字、`_`、`-`のみ。レイヤー間のマージキーにも使う
- `label`：ボタンに表示する文字。最大8文字
- `title`：長押しやアクセシビリティ用の説明
- `type`：実行する処理
- `order`：小さい値ほど共通ボタンの近くへ表示
- `enabled`：`false`で同じIDの継承ボタンを非表示
- `style`：安全な範囲に限定した見た目設定

現在対応している`type`は次の3つです。

```text
insertPrompt    入力欄へ定型文をセット
reload          ページを再読み込み
scrollToBottom  会話の最下部へ移動
```

`insertPrompt`の`mode`は次の3種類です。

```text
empty    入力欄が空の時だけセット。既定値
append   現在の文章の後ろへ追加
replace  現在の文章を置換。入力中なら確認を表示
```

`append`では`separator`を指定できます。既定値は改行です。

アクションは最大8個まで表示します。ボタンは右下の共通ボタンの左側へ、`order`順に並びます。

## Merge rules

- オブジェクトは階層ごとに再帰マージ
- 後段の同名プロパティが前段を上書き
- `id`を持つオブジェクト配列は同じ`id`をマージし、新しい`id`を追加
- それ以外の配列は後段の配列で置換

そのため、Brainの共通ボタンを残したままShionで独自ボタンを追加できます。継承したボタンを消す場合は、後段レイヤーで同じ`id`へ`enabled: false`を指定します。

## Current controls

常に表示される共通ボタンです。

```text
↻  ページを再読み込み
↓  会話の最下部へ移動
```

入力欄に文章がある状態でリロードを押した場合だけ確認を表示します。

レイヤー固有ボタンは、その左側へ表示されます。現在のShionレイヤーでは次のボタンを設定しています。

```text
栞  入力欄へ「しおり」をセット。自動送信はしない
```

入力中の文章がある場合、`栞`は上書きせず通知だけを表示します。

## Debugging

現在の判定結果はページの`<html>`要素へ記録されます。

```html
<html
  data-chatgpt-layer="shion"
  data-chatgpt-layers="brain shion"
  data-chatgpt-project-id="g-p-6a47aadbce188191b178e125bd7c4e86"
  data-chatgpt-chat-id="CHAT_ID"
  data-chatgpt-layer-config-version="2026-08-01.3"
>
```

特殊composerが適用された要素には次の属性を付けます。

```html
data-chatgpt-layer-composer-surface="on"
```

レイヤー構成が変わった時はブラウザコンソールにも判定結果を出します。

## Architecture

- `chatgpt-layer.user.js`：iPhoneへ入れる固定エンジン
- `chatgpt-layer.config.json`：Global、Project、Chatの対応表と可変設定
- `chatgpt-layer.meta.js`：固定エンジンの更新確認用メタデータ

外部JavaScriptは動的実行せず、GitHubから取得するのは検証済みJSONだけです。

## Install on iPhone / Gear Browser

1. 次のURLを開く

   `https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.user.js`

2. Gear BrowserのUserScriptとしてインストール、または既存版を最新版へ更新する
3. ChatGPTを再読み込みする
4. 画面右下に共通ボタンが表示されることを確認する
5. Shion Layerではcomposerにグラデーション、影、上端ハイライト、薄い粒状感が表示されることを確認する

固定エンジンを0.10.0へ更新した後は、composer表現とレイヤー固有ボタンの変更はJSON更新とページ再読み込みだけで反映できます。

## Update flow

### プロジェクト、チャット、テーマ、composer、アクションの追加・変更

1. `chatgpt-layer.config.json`を更新する
2. ChatGPTを再読み込みする

Gear Browser側のUserScript手動更新は不要です。

### 固定エンジン自体を変更する場合

1. 変更前に変更理由、影響範囲、手動更新の要否を確認する
2. `chatgpt-layer.user.js`と`chatgpt-layer.meta.js`の`@version`を同じ値へ上げる
3. Gear BrowserまたはUserscripts側で手動更新する
4. ChatGPTを再読み込みする

## Failure handling

GitHubへ接続できない場合は、最後に正常取得できた設定を端末内キャッシュから利用します。キャッシュもない場合は、固定の共有ボタンと空の`default`レイヤーで動作します。

## Security

- GitHubから取得するのはJSON設定だけで、外部JavaScriptは実行しない
- composerテクスチャはCSSグラデーションで生成し、外部画像を読み込まない
- 個人情報、アクセストークン、認証情報をリポジトリへ置かない
- プロジェクトID、チャットID、レイヤー名、アクションIDを検証する
- 危険なオブジェクトキーはマージ対象から除外する
- composerの色、数値、テクスチャ種別、blend modeは固定エンジン側で検証する
- アクション種別とボタンスタイルは固定エンジン側の許可リストへ限定する
- 未登録または不正なレイヤーとアクションは適用しない
