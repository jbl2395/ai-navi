/**
 * Jev API (Type Safe AI) 連携クライアント。
 *
 * サーバーサイド専用。API キーがない場合は自動的にモックへフォールバックするため、
 * 資格情報なしでも UI と現場フローの検証ができる。
 */
import type { DefectRegion, InspectionScores, Verdict } from './types';

const DEFAULT_API_URL = 'https://api.typesafeai.com/v1/classify';
const DEFAULT_MODEL = 'jev-fast-classifier-v1';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_PASS_THRESHOLD = 0.9;
const DEFAULT_FAIL_THRESHOLD = 0.6;

/** 分類ラベルと、その判定基準の説明（Jev へのリクエストに同梱する） */
export const CLASSIFICATION_LABELS = [
  {
    label: 'PASS',
    description: '表面に致命的な傷がなく、許容範囲内である',
  },
  {
    label: 'FAIL',
    description: '規定以上の傷・バリ・欠損が存在する',
  },
  {
    label: 'REVIEW',
    description: '判定が曖昧で人間の目視確認が必要',
  },
] as const;

export interface JevInference {
  scores: InspectionScores;
  regions: DefectRegion[];
  latencyMs: number;
  model: string;
  mock: boolean;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function config() {
  return {
    apiKey: process.env.JEV_API_KEY?.trim() ?? '',
    apiUrl: process.env.JEV_API_URL?.trim() || DEFAULT_API_URL,
    model: process.env.JEV_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: num(process.env.JEV_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    passThreshold: num(process.env.JEV_PASS_THRESHOLD, DEFAULT_PASS_THRESHOLD),
    failThreshold: num(process.env.JEV_FAIL_THRESHOLD, DEFAULT_FAIL_THRESHOLD),
    forceMock: process.env.JEV_FORCE_MOCK === '1',
  };
}

/** API キー未設定（もしくは強制指定）ならモックで動かす */
export function shouldUseMock(): boolean {
  const { apiKey, forceMock } = config();
  return forceMock || apiKey.length === 0;
}

/**
 * スコアから最終判定を決める。
 * FAIL は安全側に倒すため PASS より優先してしきい値判定する。
 */
export function decideVerdict(scores: InspectionScores): {
  verdict: Verdict;
  confidence: number;
} {
  const { passThreshold, failThreshold } = config();

  if (scores.FAIL >= failThreshold) {
    return { verdict: 'FAIL', confidence: scores.FAIL };
  }
  if (scores.PASS >= passThreshold) {
    return { verdict: 'PASS', confidence: scores.PASS };
  }
  // どちらのしきい値にも届かなければ人間の目視に回す
  return { verdict: 'REVIEW', confidence: scores.REVIEW };
}

/** data URL のプレフィックスを外して生の base64 だけにする */
export function stripDataUrl(image: string): { base64: string; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(image);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: 'image/jpeg', base64: image };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 合計が 1.0 になるよう正規化する */
function normalize(scores: InspectionScores): InspectionScores {
  const pass = clamp01(scores.PASS);
  const fail = clamp01(scores.FAIL);
  const review = clamp01(scores.REVIEW);
  const total = pass + fail + review;
  if (total <= 0) {
    return { PASS: 0, FAIL: 0, REVIEW: 1 };
  }
  return { PASS: pass / total, FAIL: fail / total, REVIEW: review / total };
}

/**
 * Jev のレスポンスからスコアを取り出す。
 * 実運用でのスキーマ差異に備え、代表的な形をいくつか許容する。
 */
function parseScores(payload: unknown): InspectionScores {
  const root = (payload ?? {}) as Record<string, unknown>;
  const bag: Record<string, number> = {};

  const collect = (label: unknown, score: unknown) => {
    if (typeof label !== 'string') return;
    const value = Number(score);
    if (!Number.isFinite(value)) return;
    bag[label.trim().toUpperCase()] = value;
  };

  // { classifications: [{ label, score }] } / { predictions: [...] } / { results: [...] }
  for (const key of ['classifications', 'predictions', 'results', 'labels']) {
    const list = root[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        const entry = (item ?? {}) as Record<string, unknown>;
        collect(entry.label ?? entry.class ?? entry.name, entry.score ?? entry.confidence ?? entry.probability);
      }
    }
  }

  // { scores: { PASS: 0.9, ... } }
  for (const key of ['scores', 'probabilities', 'output']) {
    const obj = root[key];
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [label, score] of Object.entries(obj as Record<string, unknown>)) {
        collect(label, score);
      }
    }
  }

  // トップレベルに PASS/FAIL/REVIEW が直接入っている場合
  for (const label of ['PASS', 'FAIL', 'REVIEW']) {
    if (label in root) collect(label, root[label]);
  }

  return normalize({
    PASS: bag.PASS ?? 0,
    FAIL: bag.FAIL ?? 0,
    REVIEW: bag.REVIEW ?? 0,
  });
}

/** レスポンスに欠陥範囲が含まれていれば取り出す（任意項目） */
function parseRegions(payload: unknown): DefectRegion[] {
  const root = (payload ?? {}) as Record<string, unknown>;
  const list = root.regions ?? root.boxes ?? root.detections;
  if (!Array.isArray(list)) return [];

  const kinds: DefectRegion['kind'][] = ['scratch', 'burr', 'chip', 'stain'];

  return list.flatMap((item): DefectRegion[] => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const box = (entry.bbox ?? entry.box ?? entry) as Record<string, unknown>;
    const x = Number(box.x ?? box.left);
    const y = Number(box.y ?? box.top);
    const width = Number(box.width ?? box.w);
    const height = Number(box.height ?? box.h);
    if (![x, y, width, height].every(Number.isFinite)) return [];

    const rawKind = String(entry.kind ?? entry.label ?? entry.type ?? 'scratch').toLowerCase();
    const kind = kinds.find((k) => k === rawKind) ?? 'scratch';

    return [
      {
        x: clamp01(x),
        y: clamp01(y),
        width: clamp01(width),
        height: clamp01(height),
        kind,
        confidence: clamp01(Number(entry.confidence ?? entry.score ?? 0.8)),
      },
    ];
  });
}

/** base64 から決定的な 32bit ハッシュを作る（モックの再現性のため） */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  // 画像全体を舐める必要はないので、先頭・中央・末尾からサンプリングする
  const step = Math.max(1, Math.floor(input.length / 4096));
  for (let i = 0; i < input.length; i += step) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * モック推論。画像内容から決定的にスコアを生成するので、
 * 同じ写真を撮り直しても判定がブレず、デモ・受け入れ確認に使える。
 */
export function mockInference(base64: string): JevInference {
  const started = Date.now();
  const seed = hash32(base64);
  const bucket = seed % 100;

  let scores: InspectionScores;
  let regions: DefectRegion[] = [];

  if (bucket < 62) {
    // PASS 寄り
    const pass = 0.93 + ((seed >>> 8) % 60) / 1000;
    scores = normalize({ PASS: pass, FAIL: (1 - pass) * 0.35, REVIEW: (1 - pass) * 0.65 });
  } else if (bucket < 85) {
    // FAIL 寄り（欠陥範囲つき）
    const fail = 0.74 + ((seed >>> 8) % 220) / 1000;
    scores = normalize({ PASS: (1 - fail) * 0.3, FAIL: fail, REVIEW: (1 - fail) * 0.7 });
    regions = [
      {
        x: 0.22 + ((seed >>> 12) % 300) / 1000,
        y: 0.18 + ((seed >>> 16) % 340) / 1000,
        width: 0.12 + ((seed >>> 20) % 160) / 1000,
        height: 0.08 + ((seed >>> 24) % 120) / 1000,
        kind: (['scratch', 'burr', 'chip', 'stain'] as const)[(seed >>> 4) % 4],
        confidence: clamp01(fail),
      },
    ];
  } else {
    // REVIEW 寄り
    const review = 0.42 + ((seed >>> 8) % 180) / 1000;
    scores = normalize({ PASS: (1 - review) * 0.55, FAIL: (1 - review) * 0.45, REVIEW: review });
    regions = [
      {
        x: 0.34,
        y: 0.3 + ((seed >>> 18) % 200) / 1000,
        width: 0.2,
        height: 0.14,
        kind: 'stain',
        confidence: clamp01(review),
      },
    ];
  }

  // 実機の体感（0.2 秒前後）に寄せた擬似レイテンシ
  const simulated = 140 + (seed % 90);
  return {
    scores,
    regions,
    latencyMs: Math.max(simulated, Date.now() - started),
    model: `${config().model} (mock)`,
    mock: true,
  };
}

/** Jev API を実際に呼ぶ。失敗時は例外を投げる。 */
export async function callJev(base64: string, mimeType: string, partNumber?: string): Promise<JevInference> {
  const { apiKey, apiUrl, model, timeoutMs } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        task: 'classification',
        // 低レイテンシ優先（現場では 0.2 秒程度での応答が要件）
        mode: 'fast',
        image: { mime_type: mimeType, data: base64 },
        labels: CLASSIFICATION_LABELS,
        // 欠陥範囲も取得できるモデルの場合に返してもらう
        return_regions: true,
        metadata: partNumber ? { part_number: partNumber } : undefined,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Jev API ${response.status}: ${body.slice(0, 300)}`);
    }

    const payload: unknown = await response.json();
    const latencyMs = Date.now() - started;
    const reported = Number((payload as Record<string, unknown>)?.latency_ms);

    return {
      scores: parseScores(payload),
      regions: parseRegions(payload),
      latencyMs: Number.isFinite(reported) ? reported : latencyMs,
      model,
      mock: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
