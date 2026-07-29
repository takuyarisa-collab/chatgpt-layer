# ChatGPT Layer

ChatGPT Webをそのまま使いながら、共通設定・プロジェクト・個別チャットに応じて個人用レイヤーを重ねるUserscriptです。

会話、履歴、推論、ChatGPT Plusの利用枠はChatGPT側に残し、画面上の見た目、ボタン、入力補助などだけを追加します。

## Current status

現在の固定エンジンは次に対応しています。

- URLからChatGPTプロジェクトIDを取得
- URLから個別チャットIDを取得
- `Global → Project → Chat` の順にレイヤー設定をマージ
- ChatGPT内の画面遷移時に自動で再判定
- 未登録ページでは `default` レイヤーを適用
- 現在のプロジェクト、チャット、適用レイヤーをHTML属性へ記録
- 全画面共通のリロードボタンと最下部スクロールボタン
- GitHubから取得するJSON設定の検証と端末内キャッシュ

## Layer priority

判定とマージの順番は固定です。

```text
1. Global settings
2. Project layers
3. Chat layers
```

たとえばBrainプロジェクト内の特定チャットへShionレイヤーを指定すると、最終設定は次のようになります。

```text
Global
  + Brain
  + Shion
  = current chat
```

ChatレイヤーはProjectレイヤーを置き換えるのではなく、その上へ追加・上書きされます。

## URL identification

次のようなURLでは、プロジェクトIDとチャットIDを別々に取得します。

```text
https://chatgpt.com/g/g-p-6a47aadbce188191b178e125bd7c4e86-brain/c/CHAT_ID
```

```text
project ID: g-p-6a47aadbce188191b178e125bd7c4e86
chat ID:    CHAT_ID
```

プロジェクト名、クエリパラメータ、表示形式には依存せず、安定したID部分だけを設定キーとして使います。

## Configuration

```json
{
  "version": "2026-07-30.1",
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
    "shion": {},
    "blank": {},
    "ui": {}
  }
}
```

- `global`：すべての画面へ共通適用する設定
- `projects`：プロジェクトIDごとに適用するレイヤー
- `chats`：チャットIDごとに追加適用するレイヤー
- `layers`：各レイヤーの実体

一つの対象へ複数レイヤーを順番に指定することもできます。

```json
{
  "layers": ["brain", "shion"]
}
```

以前の文字列形式も読み込めます。

```json
"g-p-example": "brain"
```

## Merge rules

- オブジェクトは階層ごとに再帰マージ
- 後段の同名プロパティが前段を上書き
- `id` を持つオブジェクト配列は、同じ `id` をマージし、新しい `id` を追加
- それ以外の配列は後段の配列で置換

このため、Brainの共通機能を残したまま、Shion側でテーマやボタンを追加できます。

## Current shared controls

右下に次の固定ボタンを表示します。

```text
↻  ページを再読み込み
↓  会話の最下部へ移動
```

入力欄に文章がある状態でリロードを押した場合だけ確認を表示します。

現在の共有ボタンは表示安定性を優先して固定エンジン内にあります。サイズや動作を変更する場合はUserScriptの手動更新が必要です。

## Debugging

現在の判定結果はページの `<html>` 要素へ記録されます。

```html
<html
  data-chatgpt-layer="shion"
  data-chatgpt-layers="brain shion"
  data-chatgpt-project-id="g-p-6a47aadbce188191b178e125bd7c4e86"
  data-chatgpt-chat-id="CHAT_ID"
  data-chatgpt-layer-config-version="2026-07-30.1"
>
```

- `data-chatgpt-layer`：最優先のレイヤー
- `data-chatgpt-layers`：マージされた全レイヤー

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
4. 画面右下に `↻` と `↓` が表示されることを確認する

既存の旧版や重複するスクリプトは無効化または削除してください。

## Update flow

### プロジェクト、チャット、レイヤー設定の追加・変更

1. `chatgpt-layer.config.json` を更新する
2. ChatGPTを再読み込みする

Gear Browser側の手動更新は不要です。

### 固定エンジン自体を変更する場合

1. `chatgpt-layer.user.js` と `chatgpt-layer.meta.js` の `@version` を同じ値へ上げる
2. Gear BrowserまたはUserscripts側で手動更新する
3. ChatGPTを再読み込みする

## Failure handling

GitHubへ接続できない場合は、最後に正常取得できた設定を端末内キャッシュから利用します。
キャッシュもない場合は、固定の共有ボタンと空の `default` レイヤーで動作します。

## Security

- GitHubから取得するのはJSON設定だけで、外部JavaScriptは実行しない
- 個人情報、アクセストークン、認証情報をリポジトリへ置かない
- プロジェクトID、チャットID、レイヤー名を固定エンジン側で検証する
- 危険なオブジェクトキーはマージ対象から除外する
- 未登録または不正なレイヤーは適用しない

## Next

Brain内のシオン用チャットIDを `chats` へ登録し、`shion` レイヤーの見た目と機能を作ります。
