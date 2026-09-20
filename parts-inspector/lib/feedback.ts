'use client';

import type { Verdict } from './types';

/**
 * 判定時のフィードバック（バイブレーション + 合格音 / 警告音）。
 *
 * iOS Safari では navigator.vibrate が未実装のため、振動は「対応端末のみ」の
 * ベストエフォート。音は WebAudio で生成するため音源ファイル不要で、
 * 撮影タップ（ユーザー操作）のタイミングで AudioContext を解錠しておく。
 */

let audioContext: AudioContext | null = null;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioContext) return audioContext;

  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;

  try {
    audioContext = new Ctor();
    return audioContext;
  } catch {
    return null;
  }
}

/**
 * iOS はユーザー操作の中でしか音を鳴らせない。
 * シャッターボタンの onPointerDown などから呼んで解錠する。
 */
export function unlockAudio(): void {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume();
  }
}

interface Tone {
  frequency: number;
  /** 秒 */
  duration: number;
  /** 秒（発音開始のオフセット） */
  offset: number;
  type?: OscillatorType;
  gain?: number;
}

const VERDICT_TONES: Record<Verdict, Tone[]> = {
  // 合格音: 明るい 2 音の上行
  PASS: [
    { frequency: 880, duration: 0.09, offset: 0 },
    { frequency: 1318.5, duration: 0.16, offset: 0.09 },
  ],
  // 不合格警告: 低めのブザーを 2 回
  FAIL: [
    { frequency: 220, duration: 0.18, offset: 0, type: 'square', gain: 0.18 },
    { frequency: 180, duration: 0.26, offset: 0.22, type: 'square', gain: 0.18 },
  ],
  // 要確認: 中音の単発
  REVIEW: [{ frequency: 587.3, duration: 0.22, offset: 0, type: 'triangle' }],
};

const VERDICT_VIBRATION: Record<Verdict, number | number[]> = {
  PASS: 60,
  FAIL: [90, 70, 90, 70, 180],
  REVIEW: [70, 90, 70],
};

function playTones(tones: Tone[]): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;

  for (const tone of tones) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + tone.offset;
    const peak = tone.gain ?? 0.22;

    oscillator.type = tone.type ?? 'sine';
    oscillator.frequency.setValueAtTime(tone.frequency, start);

    // クリックノイズを避けるため、短いアタックとリリースを付ける
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + tone.duration + 0.02);
  }
}

export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* 非対応端末（iOS Safari など）は無視する */
  }
}

/** 判定結果に応じた音と振動をまとめて再生する */
export function playVerdictFeedback(verdict: Verdict, options?: { sound?: boolean; haptics?: boolean }): void {
  if (options?.sound !== false) playTones(VERDICT_TONES[verdict]);
  if (options?.haptics !== false) vibrate(VERDICT_VIBRATION[verdict]);
}

/** シャッター音（短いクリック） */
export function playShutter(): void {
  playTones([{ frequency: 1600, duration: 0.05, offset: 0, type: 'square', gain: 0.1 }]);
  vibrate(25);
}
