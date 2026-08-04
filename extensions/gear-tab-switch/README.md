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
3. CRXをGearへインストール
4. 開いている各ChatGPTタブを一度再読み込み・表示する
5. 左下の`⇄`を押す

## Dormant tab recovery

v0.8.0から、表示済みChatGPTタブの`tabId`、ウィンドウ、位置、タイトル、URLを`storage.local`へ保存します。

Gear再起動後に休止タブの`url`と`pendingUrl`が空でも、次の順で保存情報と照合します。

1. 同じ`tabId`
2. 同じウィンドウ・位置・タイトル
3. 1ウィンドウ時の位置・タイトル
4. タイトルも空の場合は、1ウィンドウかつ一意な保存位置

URLが別サイトとして取得できるタブは復元候補にしません。導入直後だけ、対象のChatGPTタブを各1回表示して保存情報を作る必要があります。

## Custom update check

GearではManifest V3の標準`update_url`更新が利用できなかったため、拡張自身が`latest.json`を確認します。

- 起動後に最新版を確認
- 表示中は6時間ごとに再確認
- 新版がある場合、`⇄`の右上にオレンジ色の`↑`バッジを表示
- `↑`を押すと最新の署名済みCRXを開く
- Gearでは上書き更新できないため、旧版を削除して新版を導入する

拡張機能IDは`lfkioeccijijlcdpjcbddklngjnjjodd`です。すべてのリリースは同じ秘密鍵で署名します。署名用秘密鍵はリポジトリへ保存しません。
