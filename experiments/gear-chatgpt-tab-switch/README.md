# ChatGPT Tab Switch Test for Gear

Gear BrowserのWeb Extensionで、既存タブの取得とアクティブ化が可能かを確認する最小実験です。

## 動作

ChatGPT画面の右下に `⇄` ボタンを追加します。

- 開いているChatGPTタブを取得
- 現在のChatGPTタブの次にあるChatGPTタブを前面化
- 最後のChatGPTタブでは先頭へ戻る
- 失敗時はChatGPT画面上に理由を表示

既存のChatGPT Layerと併用すると、右下は次の並びになります。

```text
⇄  ↻  ↓
```

## v0.3.0

v0.2.1でGearが `tabs.update(tabId, { active: true })` を正しく切り替えず、現在タブを再読み込みする挙動が見られたため、次の変更を行いました。

- タブIDを重複除去
- ChatGPTページの現在URLを明示して元タブを判定
- `tabs.highlight` を優先してタブ位置で切り替え
- `tabs.highlight` が使えない場合のみ `tabs.update` へフォールバック
- 切替前の元タブID、対象タブID、index、チャットID先頭を診断表示
- 現在タブが再読み込みされた場合も診断を20秒間保持

## インストール

Gear Browserの「拡張機能をインストール」から `.crx` を選択します。

旧版を削除してから、バージョン入りの新しいCRXを入れ直します。インストール後、拡張一覧で名前とVersionが `v0.3.0` になっていることを確認し、開いているChatGPTタブをすべて再読み込みします。

## テスト方法

1. Gear Browserで異なるChatGPT会話を2枚以上開く
2. どちらかのChatGPTタブで `⇄` を押す
3. 画面に表示される `元タブ → 対象タブ` の診断を確認
4. 次のChatGPTタブが前面になれば成功

再読み込みになった場合は、再読み込み後に表示される診断文を記録します。

## 権限

- `tabs`：開いているタブの一覧取得と対象タブの前面化
- ホスト権限は `chatgpt.com` と `chat.openai.com` のみ

外部通信、解析、データ保存は行いません。診断情報はChatGPTドメインのlocalStorageへ最大20秒だけ保持します。

## 収録ファイル

- `manifest.json`
- `content.js`
- `bridge.html`
- `bridge.js`
