import type { Verdict } from './types';

/** 判定ごとの表示テーマ（全画面フィードバック用） */
export interface VerdictTheme {
  label: Verdict;
  /** 日本語のサブラベル */
  caption: string;
  /** 現場向けの指示文 */
  instruction: string;
  /** オーバーレイ背景（Tailwind クラス） */
  overlay: string;
  /** 文字・枠線の色 */
  accent: string;
  /** 枠線 */
  border: string;
  /** 履歴バッジ */
  badge: string;
  /** 検査枠ガイドの色 */
  guide: string;
  /** 生の CSS カラー（Canvas 描画・グロー用） */
  color: string;
}

export const VERDICT_THEME: Record<Verdict, VerdictTheme> = {
  PASS: {
    label: 'PASS',
    caption: '合格',
    instruction: '次の部品へ進んでください',
    overlay: 'bg-emerald-500',
    accent: 'text-emerald-950',
    border: 'border-emerald-300',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    guide: 'stroke-emerald-400',
    color: '#10b981',
  },
  FAIL: {
    label: 'FAIL',
    caption: '不合格',
    instruction: '該当部品を隔離してください',
    overlay: 'bg-red-600',
    accent: 'text-red-50',
    border: 'border-red-300',
    badge: 'bg-red-500/15 text-red-300 border-red-500/40',
    guide: 'stroke-red-400',
    color: '#dc2626',
  },
  REVIEW: {
    label: 'REVIEW',
    caption: '要確認',
    instruction: '目視で再確認してください',
    overlay: 'bg-amber-400',
    accent: 'text-amber-950',
    border: 'border-amber-200',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    guide: 'stroke-amber-400',
    color: '#fbbf24',
  },
};

/** 0.965 -> "96.5%" */
export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** 180 -> "180ms" */
export function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

/** 履歴用の時刻表示 (HH:MM:SS) */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString('ja-JP', { hour12: false });
}
