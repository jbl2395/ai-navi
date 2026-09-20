# AI Surface Inspector — 加工部品 表面キズ・欠陥 良否判定アプリ

iPhone のカメラで加工部品を撮影し、Type Safe AI 社の **Jev API**（高速分類モデル）で
表面キズ・バリ・欠損を即時に解析して **PASS / FAIL / REVIEW** を判定する、工場現場向けの PWA です。

- **Framework**: Next.js 16 (App Router, TypeScript)
- **UI**: Tailwind CSS v4 / Lucide React / Framer Motion
- **Camera**: HTML5 MediaDevices + Canvas（iPhone Safari 対応）
- **API**: サーバーサイド API Route 経由で Jev API を呼び出し（APIキーはクライアントに出しません）

## セットアップ

```bash
npm install
cp .env.local.example .env.local   # JEV_API_KEY を設定（未設定ならモックで動作）
npm run dev
```

`http://localhost:3000` を開きます。
**カメラは HTTPS もしくは localhost でのみ動作します。** 実機の iPhone から確認する場合は、
`ngrok` などで HTTPS トンネルを張るか、社内の HTTPS ホストにデプロイしてください。

## 環境変数

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `JEV_API_KEY` | （空） | Jev API キー。**未設定ならモックモードで動作** |
| `JEV_API_URL` | `https://api.typesafeai.com/v1/classify` | 分類エンドポイント |
| `JEV_MODEL` | `jev-fast-classifier-v1` | 使用モデル ID |
| `JEV_PASS_THRESHOLD` | `0.90` | PASS 判定のしきい値 |
| `JEV_FAIL_THRESHOLD` | `0.60` | FAIL 判定のしきい値（PASS より優先） |
| `JEV_TIMEOUT_MS` | `5000` | API タイムアウト |
| `JEV_FORCE_MOCK` | `0` | `1` でキーがあってもモックを使う |

### モックモードについて

`JEV_API_KEY` が未設定の場合、`lib/jev.ts` の `mockInference()` が疑似レスポンスを返します。
画像内容から決定的にスコアを生成するため、**同じ写真では常に同じ判定**になり、デモや受け入れ確認に使えます。
レイテンシも実機相当（約 150–230ms）に擬似化しています。画面右上に「モックモード」バッジが表示されます。

## 判定ロジック

`lib/jev.ts` の `decideVerdict()` で、安全側（FAIL 優先）に倒して決定します。

1. `FAIL >= JEV_FAIL_THRESHOLD` → **FAIL**（不合格）
2. `PASS >= JEV_PASS_THRESHOLD` → **PASS**（合格）
3. それ以外 → **REVIEW**（人間の目視確認へ）

## API

### `POST /api/inspect`

```jsonc
// リクエスト
{ "image": "data:image/jpeg;base64,...", "partNumber": "PN-4471" }  // partNumber は任意
```

```jsonc
// レスポンス
{
  "id": "b004950d-...",
  "verdict": "FAIL",
  "confidence": 0.902,
  "scores": { "PASS": 0.041, "FAIL": 0.902, "REVIEW": 0.057 },
  "regions": [{ "x": 0.31, "y": 0.22, "width": 0.18, "height": 0.11, "kind": "burr", "confidence": 0.88 }],
  "latencyMs": 178,
  "totalMs": 21,
  "mock": false,
  "model": "jev-fast-classifier-v1",
  "timestamp": "2026-09-20T13:40:25.715Z"
}
```

エラー: `400`（不正なリクエスト）/ `413`（画像が 8MB 超）/ `502`（Jev API エラー）/ `504`（タイムアウト）。

### `GET /api/inspect`

稼働確認用。現在のモード（`mock` / `live`）としきい値設定を返します。

## 画面と操作

| 操作 | 挙動 |
| --- | --- |
| シャッターボタン / プレビュー全面タップ | 検査枠の内側を切り出して判定 |
| 判定結果 PASS | 緑の全画面 + 合格音 + 振動、**1.8 秒で自動クローズ** |
| 判定結果 FAIL | 赤の全画面 + 警告音 + 振動、**タップするまで閉じない**（確認を必須化） |
| 判定結果 REVIEW | 黄の全画面 + 通知音 + 振動、4 秒で自動クローズ |
| 画面下部「検査履歴」 | 直近 10 件のサムネイル・判定・スコア・時刻を保持（localStorage に永続化） |

判定画面には確率スコア（例: `PASS 96.5%`）と判定時間（例: `180ms`）を表示します。

## 撮影と切り出し

プレビューは `object-cover` で全面表示し、中央の**検査枠の内側だけ**を Canvas で正方形に切り出して送信します
（`components/CameraCapture.tsx` の `computeGuideRect()` が表示と切り出しで同一の座標を使います）。
送信画像は最大 1024px / JPEG 品質 0.86 に抑え、転送時間を短縮しています。

## iPhone での注意点

- **背面カメラ**は `facingMode: { ideal: 'environment' }` で取得します。
- `playsinline` 必須。無いと Safari が全画面プレーヤーに切り替えてしまいます。
- **バイブレーションは iOS Safari では動作しません**（`navigator.vibrate` 未実装）。
  対応端末でのみ振動し、非対応端末では音と全画面カラーのみでフィードバックします。
- 音は WebAudio で生成しており音源ファイル不要です。iOS はユーザー操作中しか再生できないため、
  シャッターの `onPointerDown` で AudioContext を解錠しています。
- **ライト（トーチ）**は対応端末でのみボタンが出ます（iOS Safari は非対応）。
- ホーム画面に追加すると全画面の PWA として起動します（`public/manifest.webmanifest`）。

## ディレクトリ構成

```
parts-inspector/
├── app/
│   ├── api/inspect/route.ts     # Jev API 連携（モックフォールバック込み）
│   ├── globals.css
│   ├── layout.tsx               # PWA メタデータ / セーフエリア
│   └── page.tsx                 # 画面全体の状態管理
├── components/
│   ├── CameraCapture.tsx        # 背面カメラ・検査枠ガイド・切り出し
│   ├── InspectionHistory.tsx    # 直近 10 件の履歴
│   ├── ResultOverlay.tsx        # 全画面の判定フィードバック
│   └── ServiceWorkerRegister.tsx
├── lib/
│   ├── feedback.ts              # 合格音 / 警告音 / 振動
│   ├── image.ts                 # 履歴用サムネイル生成
│   ├── jev.ts                   # Jev クライアント・判定ロジック・モック
│   ├── types.ts
│   └── verdict.ts               # 判定ごとの配色と表示整形
├── public/
│   ├── icons/                   # PWA アイコン
│   ├── manifest.webmanifest
│   └── sw.js                    # オフライン用 Service Worker
└── .env.local.example
```

## Jev API のスキーマについて

`lib/jev.ts` の `parseScores()` / `parseRegions()` は、レスポンス形式の差異に備えて
`{ classifications: [{ label, score }] }`、`{ predictions: [...] }`、`{ scores: { PASS: ... } }` など
代表的な形を許容します。実際の契約内容に合わせて、この 2 関数とリクエストボディ
（`callJev()` 内）を調整してください。
