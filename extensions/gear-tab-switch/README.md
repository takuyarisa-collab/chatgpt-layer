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

## Custom update check

GearではManifest V3の標準`update_url`更新が利用できなかったため、v0.7.0から拡張自身が`latest.json`を確認します。

- 起動後に最新版を確認
- 表示中は6時間ごとに再確認
- 新版がある場合、`⇄`の右上にオレンジ色の`↑`バッジを表示
- `↑`を押すと最新の署名済みCRXを新しいタブで開く
- インストール後、ChatGPTタブを再読み込みするとバッジが消える

拡張機能IDは`lfkioeccijijlcdpjcbddklngjnjjodd`です。すべてのリリースは同じ秘密鍵で署名します。署名用秘密鍵はリポジトリへ保存しません。

## Update test

- v0.7.0: 初回導入版
- v0.7.1: `latest.json`が指す更新確認版

v0.7.0を導入すると、v0.7.1の更新バッジが表示される想定です。
