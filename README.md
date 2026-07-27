# ChatGPT Layer

ChatGPT Webをそのまま使いながら、個人用のボタンや入力補助を追加するUserscriptです。

会話・推論・ChatGPT Plusの利用枠はChatGPT側に残し、画面の操作だけを少しずつ用途に合わせて育てます。

## Current feature

### しおり

画面右下の「しおり」ボタンを押すと、入力欄へ `しおり` を設定して自動送信します。

- 回答生成中はボタンを無効化
- 入力途中の文章がある場合は上書き確認
- ChatGPTの画面遷移でボタンが消えても自動で再追加

## Architecture

`0.2.0` から、ローカルへ入れるUserscriptは小さなローダーになりました。

- `chatgpt-layer.user.js`：iPhoneへ一度入れる固定ローダー
- `chatgpt-layer.remote.js`：GitHubからページ読み込み時に取得する機能本体
- `chatgpt-layer.meta.js`：ローダー更新確認用メタデータ

普段の機能追加や見た目の変更は `chatgpt-layer.remote.js` だけを修正します。
そのため、通常はChatGPTを再読み込みするだけで最新版が反映されます。

GitHubへ接続できない場合は、最後に正常取得できた本体を端末内キャッシュから実行します。

## Install on iPhone / Gear Browser

1. 次のURLを開く

   `https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.user.js`

2. Gear BrowserのUserScriptとしてインストール、または既存版を `0.2.0` へ更新する
3. ChatGPTを再読み込みする
4. 紫の「しおり」ボタンが表示され、送信まで動くことを確認する

Safari + Userscriptsでも同じローダーを利用できます。
既存の旧版や重複するスクリプトは、ボタンの二重表示を避けるため無効化または削除してください。

## Update flow

### 普段の更新

1. TaCが追加・修正内容をShionへ伝える
2. Shionが `chatgpt-layer.remote.js` を修正する
3. TaCがGear BrowserのChatGPTを再読み込みする

### ローダー自体を変更する場合のみ

1. `chatgpt-layer.user.js` と `chatgpt-layer.meta.js` の `@version` を同じ値へ上げる
2. Gear BrowserまたはUserscripts側で手動更新する
3. ChatGPTを再読み込みする

ローダー更新は、通信方式やキャッシュ処理など土台を変える場合にだけ行います。

## Security

- 実行本体は、この公開リポジトリの固定URLからのみ取得する
- 個人情報、アクセストークン、認証情報をリポジトリへ置かない
- GitHubアカウントとリポジトリへの書き込み権限を保護する
- 外部の未知のスクリプトを追加で読み込まない

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
