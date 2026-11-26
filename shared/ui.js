// ゲームページ共通の UI ヘルパー。
//
//   announce('スコア 120')          // スクリーンリーダーに読み上げてもらう
//   reducedMotion()                  // 「視差効果を減らす」設定なら true
//   onHidden(() => pause())          // タブが裏に回ったとき
//   FONT                             // canvas 用フォント名（CSS と同じ丸ゴシック）

export const FONT = '"Fredoka", "M PLUS Rounded 1c", system-ui, sans-serif';

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => motionQuery.matches;

let live;
export function announce(text) {
  if (!live) {
    live = document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    document.body.append(live);
  }
  // 同じ文でも読み上げ直されるよう一度空にする
  live.textContent = '';
  setTimeout(() => (live.textContent = text), 50);
}

export function onHidden(fn) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) fn();
  });
  window.addEventListener('blur', fn);
}
