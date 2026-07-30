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

## テスト方法

1. Gear BrowserでChatGPTタブを2枚以上開く
2. どちらかのChatGPTタブで `⇄` を押す
3. 次のChatGPTタブが前面になれば成功

表示される主なエラー：

- `切替先のChatGPTタブがありません`：拡張は動作しているが、ChatGPTタブが1枚だけ
- `タブAPIを利用できません`：Gear側でTabs APIまたは権限が利用できない
- `Web Extensionとの通信に失敗しました`：Background Service Workerが動いていない

## 権限

- `tabs`：開いているタブの一覧取得と対象タブの前面化
- ホスト権限は `chatgpt.com` と `chat.openai.com` のみ

外部通信、解析、データ保存は行いません。

## 収録ファイル

- `manifest.json`
- `background.js`
- `content.js`
