# ChatGPT Tab Query Diagnostic for Gear

Gear BrowserのWeb Extensionで、ChatGPT画面内のボタンから既存タブを切り替えられるかを検証した実験です。

## 結論

現時点のGear Browserでは、ChatGPTページ内へ非表示の拡張機能ページ（`bridge.html`）をiframeとして読み込む方式は利用できません。

`bridge.html`を読み込んだ時点で、現在のChatGPTタブが再読み込みされます。

これはタブ切替APIの問題ではありません。v0.3.1では `tabs.highlight` と `tabs.update` を完全に外し、`tabs.query({})` だけにしても同じ再読み込みが発生しました。

## 検証履歴

### v0.1.0

- content scriptからBackground Service Workerへ `runtime.sendMessage()`
- Gearで `Invalid call to runtime.sendMessage(). Tab not found.`

### v0.2.1

- `runtime.sendMessage()`を廃止
- ChatGPTページ内へ非表示の `bridge.html` を読み込み、拡張機能ページからTabs APIを実行
- ボタンを押すと現在タブが再読み込み

### v0.3.0

- `tabs.update`ではなく`tabs.highlight`を優先
- 結果は変わらず、現在タブが再読み込み

### v0.3.1

- タブ切替処理を完全に停止
- `tabs.query({})`だけを実行する診断版
- パネル表示前に現在タブが即再読み込み

## 判断

ChatGPTページ内の固定ボタンから、Bridgeまたはruntimeメッセージ経由で既存タブを切り替える方式は中止します。

次に試す価値があるのは、ChatGPTページ内ボタンではなく、Gear側のWeb Extensionアクション／ポップアップからTabs APIを実行する方式です。

UserScriptで可能なのは、指定URLを新しいタブで開くところまでです。既存タブの取得・選択には利用できません。
