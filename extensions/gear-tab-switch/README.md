# ChatGPT Layer Tab Switch for Gear

ChatGPT LayerのGear Browser用コンパニオン拡張です。

全画面表示中でも、ChatGPT画面の左下にある`⇄`ボタンから、同じGearウィンドウで既に開いている次のChatGPTタブへ切り替えます。

## Requirements

- Gear Browser v7.4.15以降
- 同じウィンドウにChatGPTタブが2枚以上

## Behavior

```text
ChatGPT上の⇄ボタン
→ Content Script
→ runtime.sendMessage
→ Background Service Worker
→ tabs.update(tabId, { active: true })
```

URL遷移、新規タブ作成、iframe Bridgeは使用しません。

## Position

- 左端から16px
- 下端から120px
- ChatGPT Layerの右下ボタン群とは左右に分離

## Install

1. Gear Browserをv7.4.15以降へ更新
2. 旧版を削除
3. 初回導入用CRXをGearへインストール
4. 開いている各ChatGPTタブを一度再読み込み
5. 左下の`⇄`を押す

ChatGPTタブが1枚しかない場合やTabs APIでエラーが出た場合は、左下に通知を表示します。

## Self-hosted update test

v0.6.0から、Manifest V3の`update_url`を使うセルフホスト更新テストを開始しました。

- 拡張機能ID: `lfkioeccijijlcdpjcbddklngjnjjodd`
- 更新情報: `updates.xml`
- 配布先: `releases/`
- 最新テスト版: v0.6.1

初回導入用v0.6.0と更新先v0.6.1は、同じ秘密鍵で署名されています。Gearが標準の更新機構へ対応している場合、v0.6.0を導入した後、`updates.xml`を通じてv0.6.1へ更新されます。

署名用秘密鍵はリポジトリへ保存しません。将来の更新でも同じ鍵が必要です。
