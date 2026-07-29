# ChatGPT Layer

ChatGPT Webをそのまま使いながら、開いているプロジェクトに応じて個人用レイヤーを自動で切り替えるUserscriptです。

会話・推論・ChatGPT Plusの利用枠はChatGPT側に残し、画面上の見た目、ボタン、入力補助などをプロジェクト単位で育てます。

## Current status

現在は、プロジェクト別レイヤーを載せるための基盤版です。

- URLからChatGPTプロジェクトIDを取得
- プロジェクトIDとレイヤー名を設定で対応付け
- ChatGPT内の画面遷移時に自動で再判定
- 未登録ページでは空の `default` レイヤーを適用
- 現在のレイヤーとプロジェクトIDをHTML属性へ記録
- GitHubから取得するのは検証済みJSON設定だけ

以前のShion themeと「しおり」ボタンは検証用だったため、基盤整理に合わせて一度外しています。

## Architecture

- `chatgpt-layer.user.js`：iPhoneへ入れる固定エンジン
- `chatgpt-layer.config.json`：プロジェクト対応表と各レイヤーの可変設定
- `chatgpt-layer.meta.js`：固定エンジンの更新確認用メタデータ

固定エンジンはURLからプロジェクトIDを判定し、設定内の `projects` を使って適用するレイヤーを選びます。

```text
ChatGPTのURL
  ↓
プロジェクトIDを取得
  ↓
projectsの対応表を確認
  ↓
brain / shion / blank / ui / default
```

たとえば次のURLでは、

```text
https://chatgpt.com/g/g-p-6a47aadbce188191b178e125bd7c4e86-brain/c/...
```

次の固定部分をプロジェクトIDとして扱います。

```text
g-p-6a47aadbce188191b178e125bd7c4e86
```

末尾のプロジェクト名や個別チャットIDには依存しません。

## Configuration

```json
{
  "version": "2026-07-29.1",
  "base": {},
  "projects": {
    "g-p-6a47aadbce188191b178e125bd7c4e86": "brain"
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

- `base`：全レイヤー共通の設定を置く領域
- `projects`：プロジェクトIDとレイヤー名の対応表
- `layers`：各プロジェクト向けの設定を置く領域

未登録のプロジェクト、通常チャット、ホーム画面では `default` が選ばれます。

## Debugging

現在の判定結果はページの `<html>` 要素へ記録されます。

```html
<html
  data-chatgpt-layer="brain"
  data-chatgpt-project-id="g-p-6a47aadbce188191b178e125bd7c4e86"
  data-chatgpt-layer-config-version="2026-07-29.1"
>
```

レイヤーが切り替わった時はブラウザコンソールにも判定結果を出します。

## Install on iPhone / Gear Browser

1. 次のURLを開く

   `https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.user.js`

2. Gear BrowserのUserScriptとしてインストール、または既存版を最新版へ更新する
3. ChatGPTを再読み込みする

Safari + Userscriptsでも同じ固定エンジンを利用できます。
既存の旧版や重複するスクリプトは無効化または削除してください。

## Update flow

### プロジェクトやレイヤー設定の追加・変更

1. TaCが追加・修正内容をShionへ伝える
2. Shionが `chatgpt-layer.config.json` を修正する
3. TaCがChatGPTを再読み込みする

### 固定エンジン自体を変更する場合のみ

1. `chatgpt-layer.user.js` と `chatgpt-layer.meta.js` の `@version` を同じ値へ上げる
2. Gear BrowserまたはUserscripts側で手動更新する
3. ChatGPTを再読み込みする

## Failure handling

GitHubへ接続できない場合は、最後に正常取得できた設定を端末内キャッシュから利用します。
キャッシュもない場合は、空の内蔵 `default` レイヤーで動作します。

## Security

- GitHubから取得するのはJSON設定だけで、外部JavaScriptは実行しない
- 個人情報、アクセストークン、認証情報をリポジトリへ置かない
- 設定値は固定エンジン側で形式を検証してから利用する
- 未登録または不正なレイヤー名は `default` へ戻す

## Next

基盤の動作確認後、各プロジェクトIDを登録し、それぞれのレイヤーを一つずつ作ります。

- Brain layer
- Shion layer
- blank layer
- ui layer
