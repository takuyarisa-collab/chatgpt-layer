# ChatGPT Tab Query Diagnostic for Gear

Gear BrowserのWeb Extensionが返すタブ情報を、安全に確認する診断実験です。

## v0.3.1

v0.3.0では `tabs.highlight` / `tabs.update` の呼び出し直後に現在タブが再読み込みされ、診断メッセージも表示されませんでした。

v0.3.1では切替APIを一切呼びません。

- `tabs.query({})` だけを実行
- 取得したChatGPTタブの `id / windowId / index / active / URL` を画面に表示
- タブ切替、URL変更、再読み込みは行わない

## インストール

1. Gearから旧実験版を削除
2. `gear-chatgpt-tab-query-v0.3.1.crx` を新規インストール
3. 拡張一覧で `ChatGPT Tab Query Diagnostic for Gear v0.3.1` を確認
4. ChatGPTタブを再読み込み

## テスト

1. 異なるChatGPT会話を2枚以上開く
2. 右下の茶色い `?` ボタンを押す
3. 表示された診断パネルをスクリーンショットする

この版で再読み込みが起きる場合、GearのWeb Extension実装が `tabs.query` 自体を正しく扱えていない可能性が高いです。
