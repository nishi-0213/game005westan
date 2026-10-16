# ゲーム用スプライト

最新の素材集は `assets/source/素材_追加.zip`、以前の素材集は `assets/source/素材.zip` に保存しています。下記19枚は最新ZIPから変更せずに取り出し、英語のファイル名で参照しています。

| 元ファイル | 使用ファイル | 主な表示 |
|---|---|---|
| ポーン_体.png | pawn-body.png | 肌色を調整する身体レイヤー |
| ポーン_眼.png | pawn-eyes.png | 色相・彩度を調整する青い目の素体 |
| 髪1.png | hair-1.png | 髪型1 |
| 髪2.png | hair-2.png | 髪型2 |
| 岩.png | rock.png | 採掘対象の岩 |
| 壁(木材).png | wall-wood.png | 木材の壁・建設予定 |
| 壁(石材).png | wall-stone.png | 石材の壁・建設予定 |
| 床(木材).png | floor-wood.png | 木張りの床・建設予定 |
| 床(石材).png | floor-stone.png | 石張りの床・建設予定 |
| 木材(アイテム).png | item-wood.png | 木材アイテム |
| 石材(アイテム).png | item-stone.png | 石材アイテム |
| 苺(アイテム).png | item-strawberry.png | 苺アイテム・食事表示 |
| 苺.png | strawberry.png | 野苺の植物 |
| ナイフ.png | knife.png | 地面・装備・アイテム表示 |
| ライフル.png | rifle.png | 地面・装備・アイテム表示 |
| 鹿.png | deer.png | 鹿・死体表示 |
| 草.png | grass.png | 雑草 |
| 木.png | tree.png | 木 |
| 狼.png | wolf.png | 狼・死体表示 |

全画像は32×32の透過PNGです。インデックスカラーの画像も透過情報を維持して読み込み、ニアレストネイバーで表示します。以前の `pawn.png` は汎用の人間の死体アイコン用に残しています。

身体・目の着色は `src/pawn-appearance.ts`、画像生成と重ね合わせは `src/pawn-artwork.ts` が担当します。身体と目は正式な分離済みPNGを直接読み込みます。髪は「なし・髪1・髪2」を等確率で生成時に抽選し、身体と目の上・帽子の下に表示します。マップとポートレートで同じ外見を使います。
