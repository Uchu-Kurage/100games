// 高解像度ディスプレイ（Retina など）でもくっきり描画できる canvas を用意する。
// 戻り値の width / height は「CSS ピクセル」単位なので、ゲーム側は DPR を意識しなくてよい。
export function setupCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.aspectRatio = `${width} / ${height}`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}
