/** 検査判定のラベル */
export type Verdict = 'PASS' | 'FAIL' | 'REVIEW';

/** 3 クラス分類の確率スコア（合計 1.0） */
export interface InspectionScores {
  /** 表面に致命的な傷がなく、許容範囲内である確率 */
  PASS: number;
  /** 規定以上の傷・バリ・欠損が存在する確率 */
  FAIL: number;
  /** 判定が曖昧で人間の目視確認が必要な確率 */
  REVIEW: number;
}

/** 欠陥の検出範囲（画像に対する 0.0-1.0 の相対座標） */
export interface DefectRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 欠陥種別（scratch: キズ / burr: バリ / chip: 欠損 / stain: 汚れ） */
  kind: 'scratch' | 'burr' | 'chip' | 'stain';
  confidence: number;
}

/** /api/inspect のレスポンス */
export interface InspectionResult {
  id: string;
  verdict: Verdict;
  /** 判定ラベルの確率（0.0-1.0） */
  confidence: number;
  scores: InspectionScores;
  /** 検出された欠陥範囲 */
  regions: DefectRegion[];
  /** 推論にかかった時間（ミリ秒） */
  latencyMs: number;
  /** サーバー側の総処理時間（ミリ秒） */
  totalMs: number;
  /** Jev API を呼ばずモックで応答したか */
  mock: boolean;
  model: string;
  /** ISO8601 タイムスタンプ */
  timestamp: string;
}

/** 履歴 1 件（結果 + サムネイル） */
export interface InspectionRecord extends InspectionResult {
  /** data:image/jpeg;base64,... 形式のサムネイル */
  thumbnail: string;
}

/** /api/inspect のリクエスト */
export interface InspectionRequest {
  /** data:image/jpeg;base64,... もしくは生の base64 文字列 */
  image: string;
  /** 任意: 部品番号・ロット番号などの識別子 */
  partNumber?: string;
}

export interface ApiErrorResponse {
  error: string;
  detail?: string;
}
