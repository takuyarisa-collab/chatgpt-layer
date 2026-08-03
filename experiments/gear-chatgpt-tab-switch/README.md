# ChatGPT Tab Switch for Gear v0.4.0

Gear Browser v7.4.15で修正されたWeb ExtensionのTabs APIを再検証する最小版です。

## 構成

- ChatGPT画面内に緑色の `⇄` ボタンを表示
- Content ScriptからBackground Service Workerへメッセージ送信
- 同じウィンドウ内のChatGPTタブを列挙
- 現在タブの次にあるChatGPTタブへ `tabs.update(tabId, { active: true })` で切り替え
- iframe、bridge.html、URL遷移は使用しない

## テスト

1. Gear Browserをv7.4.15以上へ更新
2. 異なるChatGPT会話を2枚以上のタブで開く
3. この拡張をインストール
4. ChatGPTタブを再読み込み
5. 緑色の `⇄` を押す

成功時は、ページの再読み込みではなく、すでに開いている次のChatGPTタブが即座に表示されます。
