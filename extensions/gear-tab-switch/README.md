# ChatGPT Layer Tab Switch for Gear

Room LayerのGear Browser用タブナビゲーション実装です。

`v0.9.0`では、従来の独立した`⇄`ボタンを表示せず、Room Layer UserScriptのQuick ActionからBridge Protocol v1経由で呼び出されます。

## Product role

Room LayerをGearでフルスクリーン運用したまま、既に開いている複数のChatGPTタブを移動するためのブラウザ権限層です。

```text
Room Layer Quick Action ⇄
→ DOM Bridge Protocol v1
→ Extension Content Script
→ runtime.sendMessage
→ Background Service Worker
→ tabs.query()
→ tabs.update(tabId, { active: true })
```

Room Layer側がUIを所有し、このExtensionはブラウザ権限が必要な処理だけを担当します。

## Requirements

- Gear Browser v7.4.15以降
- Room Layer Dev `0.3.0-dev12`以降
- 同じウィンドウにChatGPTタブが2枚以上

## Bridge Protocol v1

ページ側で許可するコマンドは固定の2種類だけです。

```text
PING
SWITCH_NEXT
```

Bridgeレスポンスは次のような限定情報だけを返します。

- 成功 / 失敗
- bounded error code
- 認識できたChatGPTタブ数
- dormant recovery件数
- 切替先がdormant recovery対象だったか
- Extension version
- Bridge protocol version

ChatGPTタブのタイトル、URL、Chat ID、Project IDはRoom Layerへ返しません。

## UI ownership

`v0.8.0`までのExtension独自UIは`v0.9.0`で削除します。

削除対象:

- 左下の独立`⇄`ボタン
- 独立Toast
- UI維持用MutationObserver
- 独立更新バッジ

Room Layer側のQuick Actionsが表示とエラー案内を担当します。

## Dormant tab recovery

v0.8.0で導入した復元ロジックを継続します。

表示済みChatGPTタブの`tabId`、ウィンドウ、位置、タイトル、URLをExtensionの`storage.local`へ保存し、Gear再起動後に休止タブの`url`と`pendingUrl`が空でも保存情報と照合します。

照合順の基本:

1. 同じ`tabId`
2. 同じウィンドウ・位置・タイトル
3. 1ウィンドウ時の位置・タイトル
4. タイトルも空の場合は、1ウィンドウかつ一意な保存位置

URLが別サイトとして取得できるタブは復元候補にしません。

## Development packaging

正式なExtension IDは既存v0.8と同じ`lfkioeccijijlcdpjcbddklngjnjjodd`を維持し、公式CRXは従来と同じ秘密鍵で署名する必要があります。秘密鍵はリポジトリへ保存しません。

開発中の実機検証では、一時的なdev署名CRXを使う場合があります。その場合はExtension IDと`storage.local`が正式版とは別になりますが、Tab Switch v0.8由来のロジック検証には影響しません。

`latest.json`は正式に署名したCRXを公開するまでv0.8.0を指したままにします。

## dev12 completion target

- Room LayerがExtension接続を検出できる
- Room Layerの`⇄` Quick Actionから次のChatGPTタブへ切り替えられる
- Gear標準UIを開かずフルスクリーンを維持できる
- 1タブしかない場合は安全に失敗する
- Composer / Woodのdev10以降の性能基準を崩さない

Tab切替後のChat / Project再判定とRoom再適用の本格検証はRoom Layer dev13で行います。
