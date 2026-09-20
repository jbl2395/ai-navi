'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Eye, Timer, XCircle } from 'lucide-react';
import { useEffect } from 'react';

import { playVerdictFeedback } from '@/lib/feedback';
import type { InspectionResult, Verdict } from '@/lib/types';
import { VERDICT_THEME, formatMs, formatPercent } from '@/lib/verdict';

/** 自動で閉じるまでの時間（ms）。FAIL は作業者の確認操作を必須にするため閉じない。 */
const AUTO_DISMISS_MS: Record<Verdict, number | null> = {
  PASS: 1800,
  REVIEW: 4000,
  FAIL: null,
};

const VERDICT_ICON: Record<Verdict, typeof CheckCircle2> = {
  PASS: CheckCircle2,
  FAIL: XCircle,
  REVIEW: Eye,
};

interface ResultOverlayProps {
  result: InspectionResult | null;
  /** 判定対象の撮影画像（data URL） */
  image: string | null;
  onDismiss: () => void;
}

export function ResultOverlay({ result, image, onDismiss }: ResultOverlayProps) {
  const verdict = result?.verdict;

  // 判定が出た瞬間に音と振動でフィードバックする
  useEffect(() => {
    if (!verdict) return;
    playVerdictFeedback(verdict);
  }, [verdict, result?.id]);

  // PASS / REVIEW は一定時間で自動的に閉じ、ライン作業を止めない
  useEffect(() => {
    if (!verdict) return;
    const delay = AUTO_DISMISS_MS[verdict];
    if (delay === null) return;

    const timer = window.setTimeout(onDismiss, delay);
    return () => window.clearTimeout(timer);
  }, [verdict, result?.id, onDismiss]);

  return (
    <AnimatePresence>
      {result && verdict && (
        <motion.div
          key={result.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={onDismiss}
          role="alertdialog"
          aria-live="assertive"
          aria-label={`判定 ${verdict}`}
          className={`pt-safe pb-safe fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 px-6 ${VERDICT_THEME[verdict].overlay}`}
        >
          <VerdictBody result={result} image={image} />
          <p className={`text-base font-semibold opacity-70 ${VERDICT_THEME[verdict].accent}`}>
            {AUTO_DISMISS_MS[verdict] === null ? '画面をタップして確認' : '画面をタップで次へ'}
          </p>

          {/* 自動クローズの残り時間 */}
          {AUTO_DISMISS_MS[verdict] !== null && (
            <motion.span
              className="absolute inset-x-0 bottom-0 h-1.5 origin-left bg-black/25"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: (AUTO_DISMISS_MS[verdict] ?? 0) / 1000, ease: 'linear' }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function VerdictBody({ result, image }: { result: InspectionResult; image: string | null }) {
  const theme = VERDICT_THEME[result.verdict];
  const Icon = VERDICT_ICON[result.verdict];

  return (
    <>
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 24 }}
        className={`flex flex-col items-center ${theme.accent}`}
      >
        <Icon className="h-24 w-24" strokeWidth={2.2} />
        <p className="mt-2 text-[5.5rem] font-black leading-none tracking-tight sm:text-[7rem]">{result.verdict}</p>
        <p className="mt-1 text-3xl font-bold">{theme.caption}</p>
        <p className="mt-3 text-lg font-semibold opacity-80">{theme.instruction}</p>
      </motion.div>

      {/* 撮影画像と検出範囲 */}
      {image && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          className={`relative aspect-square w-40 overflow-hidden rounded-xl border-4 ${theme.border} shadow-lg`}
        >
          {/* 撮影済みの data URL をそのまま表示するため img を使う */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="撮影した検査面" className="h-full w-full object-cover" />
          {result.regions.map((region, index) => (
            <span
              key={`${region.kind}-${index}`}
              className="absolute border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.5)]"
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
            />
          ))}
        </motion.div>
      )}

      {/* スコアとレイテンシ */}
      <div className={`flex flex-wrap items-center justify-center gap-3 ${theme.accent}`}>
        <Metric label={result.verdict} value={formatPercent(result.confidence)} />
        <Metric icon={<Timer className="h-5 w-5" />} label="判定時間" value={formatMs(result.latencyMs)} />
      </div>

      <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm font-bold ${theme.accent} opacity-70`}>
        <span>PASS {formatPercent(result.scores.PASS)}</span>
        <span>FAIL {formatPercent(result.scores.FAIL)}</span>
        <span>REVIEW {formatPercent(result.scores.REVIEW)}</span>
      </div>

      {result.mock && (
        <p className={`flex items-center gap-1.5 text-sm font-bold ${theme.accent} opacity-80`}>
          <AlertTriangle className="h-4 w-4" />
          モックモード（JEV_API_KEY 未設定）
        </p>
      )}
    </>
  );
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <span className="flex items-center gap-2 rounded-full bg-black/15 px-5 py-2.5 text-2xl font-black tabular-nums">
      {icon}
      <span className="text-base font-bold opacity-70">{label}</span>
      {value}
    </span>
  );
}
