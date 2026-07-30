# ChatGPT Tab Switch Test for Gear

Gear BrowserのWeb Extensionで、既存タブの取得とアクティブ化が可能かを確認する最小実験です。

## 動作

ChatGPT画面の右下に `⇄` ボタンを追加します。

- 開いているChatGPTタブを同一ウィンドウ内から取得
- 現在のChatGPTタブの次にあるChatGPTタブを前面化
- 最後のChatGPTタブでは先頭へ戻る
- 失敗時はChatGPT画面上に理由を表示

既存のChatGPT Layerと併用すると、右下は次の並びになります。

```text
⇄  ↻  ↓
```

## v0.2.0

Gearで `runtime.sendMessage()` が `Tab not found` になるため、Background Service Workerへのメッセージ送信を廃止しました。

代わりに、ChatGPTページ内へ非表示の拡張機能ページ `bridge.html` を読み込み、その拡張機能ページ自身がTabs APIを直接実行します。

## Gearへのインストール

Gearのローカルインストール画面は `.crx` または `.xpi` を受け付けます。
この実験はChrome系Manifest V3として作成しているため、Chromiumで生成した `.crx` を使用します。

1. `gear-chatgpt-tab-switch.crx` をiPhoneへ保存する
2. Gearの「拡張機能をインストール」を開く
3. 「拡張機能ファイルを選択（.crx または .xpi）」を押す
4. `.crx` を選択してインストールする
5. ChatGPTタブを再読み込みする

すでにv0.1.0を入れている場合は、同じ署名鍵で作ったv0.2.0を選択します。上書きされない場合は旧版を削除してから入れ直します。

署名用の秘密鍵 `.pem` は配布・リポジトリ保存しません。

## テスト方法

1. Gear BrowserでChatGPTタブを2枚以上開く
2. どちらかのChatGPTタブで `⇄` を押す
3. 次のChatGPTタブが前面になれば成功

表示される主なエラー：

- `切替先のChatGPTタブがありません`：拡張とTabs APIは動作しているが、ChatGPTタブが1枚だけ
- `タブAPIを利用できません`：Gear側でTabs APIまたは権限が利用できない
- `bridge.htmlを読み込めませんでした`：Web Accessible Resourceが利用できない
- `拡張機能ページから応答がありません`：iframeの拡張機能コンテキストが動作していない

## 権限

- `tabs`：開いているタブの一覧取得と対象タブの前面化
- ホスト権限は `chatgpt.com` と `chat.openai.com` のみ

外部通信、解析、データ保存は行いません。

## 収録ファイル

- `manifest.json`
- `content.js`
- `bridge.html`
- `bridge.js`
