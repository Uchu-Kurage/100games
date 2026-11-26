// requestAnimationFrame によるゲームループ。
// update(dt) の dt は前フレームからの経過秒。タブ復帰時などの大きな飛びは maxDt で抑える。
export function startLoop({ update, render, maxDt = 0.1 }) {
  let last = performance.now();
  let rafId = 0;
  let running = true;

  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, maxDt);
    last = now;
    update?.(dt);
    render?.();
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
