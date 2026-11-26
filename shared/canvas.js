// 高解像度ディスプレイ（Retina など）や拡大表示でもくっきり描画できる canvas を用意する。
// 実際に表示されているサイズ × devicePixelRatio に合わせて内部解像度を自動で調整する。
// 戻り値の width / height は「ゲーム内座標」なので、ゲーム側は解像度を意識しなくてよい。
export function setupCanvas(canvas, width, height) {
  canvas.style.aspectRatio = `${width} / ${height}`;
  const ctx = canvas.getContext('2d');

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || width;
    const scale = (cssWidth * dpr) / width;
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);

  return { ctx, width, height };
}
