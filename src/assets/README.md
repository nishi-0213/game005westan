# ゲーム用スプライト

元データはリポジトリの `assets/source/素材.zip` に保存しています。PNGは元データから変更せずに取り出し、参照用のファイル名を英語に統一しています。

| 元ファイル | 使用ファイル | 主な表示 |
|---|---|---|
| ナイフ.png | knife.png | 地面・装備・アイテム表示 |
| ポーン.png | pawn.png | 人間・一覧のポートレート・死体表示 |
| ライフル.png | rifle.png | 地面・装備・アイテム表示 |
| 鹿.png | deer.png | 鹿・死体表示 |
| 草.png | grass.png | 雑草 |
| 木.png | tree.png | 木 |
| 狼.png | wolf.png | 狼・死体表示 |
| 苺.png | strawberry.png | 野苺・苺アイテム表示 |

全画像は32×32の透過PNGです。`src/sprite-assets.ts` で読み込み、ニアレストネイバーで表示します。拡大縮小や回転、植物の成長表示は描画側で適用します。

ポーンの身体・目の色変更は `src/pawn-appearance.ts` と `src/pawn-artwork.ts` が担当します。現在は既存の `pawn.png` の目の位置を分離して青い目の素体を作り、身体と別々に着色しています。チャット内に表示された分離画像のPNG元ファイルはまだ保存されていません。分離済み透過PNGが取得できたら、`loadPawnArtwork({bodyUrl, eyesUrl})` で読み込めます。両画像は同じ寸法・同じ原点に揃えてください。
