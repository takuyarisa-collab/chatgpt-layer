# ChatGPT Layer

ChatGPT Webをそのまま使いながら、個人用のボタンや入力補助を追加するUserscriptです。

会話・推論・ChatGPT Plusの利用枠はChatGPT側に残し、画面の操作だけを少しずつ用途に合わせて育てます。

## Current feature

### しおり

画面右下の「しおり」ボタンを押すと、入力欄へ `しおり` を設定して自動送信します。

- 回答生成中はボタンを無効化
- 入力途中の文章がある場合は上書き確認
- ChatGPTの画面遷移でボタンが消えても自動で再追加

## Files

- `chatgpt-layer.user.js`：実行コード本体
- `chatgpt-layer.meta.js`：更新確認用メタデータ

## Install on iPhone

前提として、iPhoneにUserscriptsを入れ、Safari拡張を有効にします。

1. Safariで次のURLを開く

   `https://raw.githubusercontent.com/takuyarisa-collab/chatgpt-layer/main/chatgpt-layer.user.js`

2. Userscriptsからインストール、または既存スクリプトを置き換える
3. Userscriptsのサイト権限を `chatgpt.com` に許可する
4. ChatGPTを再読み込みする
5. 既存のローカル版「しおり」スクリプトは、二重表示を避けるため無効化または削除する

## Update flow

1. TaCが追加・修正内容をShionへ伝える
2. Shionがこのリポジトリのコードを修正する
3. `chatgpt-layer.user.js` と `chatgpt-layer.meta.js` の `@version` を同じ値へ上げる
4. TaCがiPhoneのUserscriptsで更新を確認する
5. ChatGPTを再読み込みして反映を確認する

更新機能が反応しない場合は、上記のRaw URLをSafariで開き、最新版を上書きインストールします。

## Design principles

- OpenAI APIを使わない
- ChatGPTの会話履歴と既存ツールをそのまま利用する
- 個人情報、アクセストークン、認証情報をリポジトリへ置かない
- 一度に機能を増やしすぎず、実際に使うものを一つずつ追加する
- ChatGPT側の画面構造変更で壊れる可能性を前提に、小さく修正しやすく保つ

## Planned ideas

- Brainへ残す
- 家計簿入力
- uiの生活ログ
- 会話要約
- ユナ向けブリーフ作成

必要性が確認できた機能から順番に追加します。
