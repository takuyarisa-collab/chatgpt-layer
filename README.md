# ChatGPT Layer

ChatGPT Webをそのまま使いながら、個人用のボタンや見た目の調整を追加するUserscriptです。

会話・推論・ChatGPT Plusの利用枠はChatGPT側に残し、画面の操作だけを少しずつ用途に合わせて育てます。

## Current features

### しおり

画面右下の「しおり」ボタンを押すと、入力欄へ `しおり` を設定して自動送信します。

- 回答生成中はボタンを無効化
- 入力途中の文章がある場合は上書き確認
- ChatGPTの画面遷移でボタンが消えても自動で再追加

### Shion theme

ChatGPT全体を、黒を基調に紫の気配が薄く灯る配色へ変更します。

- 会話画面
- サイドバー
- 入力欄
- 文字色と境界線

色は `chatgpt-layer.config.json` から読み込むため、ローダー更新後はGitHubの設定変更とページ再読み込みだけで調整できます。

## Architecture

`0.2.1` から、外部JavaScriptを実行せず、GitHub上のJSON設定だけを読み込む方式になりました。

- `chatgpt-layer.user.js`：iPhoneへ入れるローダー兼固定エンジン
- `chatgpt-layer.config.json`：ボタン、位置、テーマなどの可変設定
- `chatgpt-layer.meta.js`：ローダー更新確認用メタデータ

普段のボタン設定や配色変更は `chatgpt-layer.config.json` だけを修正します。
そのため、通常はChatGPTを再読み込みするだけで最新版が反映されます。

GitHubへ接続できない場合は、最後に正常取得できた設定を端末内キャッシュから利用します。キャッシュもない場合は、ローダー内蔵設定で動作します。

## Install on iPhone / Gear Browser

1. 次のURLを開く

   `https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.user.js`

2. Gear BrowserのUserScriptとしてインストール、または既存版を最新版へ更新する
3. ChatGPTを再読み込みする
4. 紫の「しおり」ボタンとShion themeが表示されることを確認する

Safari + Userscriptsでも同じローダーを利用できます。
既存の旧版や重複するスクリプトは、ボタンの二重表示を避けるため無効化または削除してください。

## Update flow

### 普段の更新

1. TaCが追加・修正内容をShionへ伝える
2. Shionが `chatgpt-layer.config.json` を修正する
3. TaCがGear BrowserのChatGPTを再読み込みする

### ローダー自体を変更する場合のみ

1. `chatgpt-layer.user.js` と `chatgpt-layer.meta.js` の `@version` を同じ値へ上げる
2. Gear BrowserまたはUserscripts側で手動更新する
3. ChatGPTを再読み込みする

ローダー更新は、対応できる機能や設定項目など、土台を変える場合にだけ行います。

## Theme settings

`chatgpt-layer.config.json` の `theme` で次の色を変更できます。

- `pageBackground`：会話画面の基本背景
- `surfaceBackground`：補助面
- `surfaceAltBackground`：コードや別階層の面
- `sidebarBackground`：サイドバー
- `composerBackground`：入力欄
- `textColor`：基本文字色
- `mutedTextColor`：補助文字色
- `borderColor`：境界線
- `accentColor`：カーソルなどのアクセント

`enabled` を `false` にするとテーマを無効化できます。

## Security

- GitHubから取得するのはJSON設定だけで、外部JavaScriptは実行しない
- 個人情報、アクセストークン、認証情報をリポジトリへ置かない
- GitHubアカウントとリポジトリへの書き込み権限を保護する
- 設定値はエンジン側で形式を検証してから利用する

## Design principles

- OpenAI APIを使わない
- ChatGPTの会話履歴と既存ツールをそのまま利用する
- 一度に機能を増やしすぎず、実際に使うものを一つずつ追加する
- ChatGPT側の画面構造変更で壊れる可能性を前提に、小さく修正しやすく保つ

## Planned ideas

- Brainへ残す
- 家計簿入力
- uiの生活ログ
- 会話要約
- ユナ向けブリーフ作成

必要性が確認できた機能から順番に追加します。