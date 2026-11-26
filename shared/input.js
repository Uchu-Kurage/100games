// キーボードとポインター（マウス・タッチ共通）の入力をまとめて扱う。
//
//   const input = createInput(canvas, { width: 480, height: 320 });
//   input.isDown('ArrowLeft')    // 押しっぱなし判定（e.code で指定）
//   input.wasPressed('Space')    // このフレームで押された瞬間
//   input.pointer                // { x, y, down } ゲーム座標系
//   input.onPointerDown((p) => {...})
//   input.endFrame()             // update の最後に呼ぶ
export function createInput(canvas, { width, height }) {
  const down = new Set();
  const pressed = new Set();
  const pointer = { x: 0, y: 0, down: false };
  const pointerDownHandlers = [];

  window.addEventListener('keydown', (e) => {
    if (!down.has(e.code)) pressed.add(e.code);
    down.add(e.code);
    // 矢印キーやスペースでページがスクロールしないようにする
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());

  // 画面上の座標 → ゲーム内座標（canvas の論理サイズ）に変換
  function toGame(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * width;
    pointer.y = ((e.clientY - rect.top) / rect.height) * height;
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    toGame(e);
    pointer.down = true;
    pointerDownHandlers.forEach((fn) => fn(pointer));
  });
  canvas.addEventListener('pointermove', toGame);
  window.addEventListener('pointerup', () => (pointer.down = false));

  return {
    pointer,
    isDown: (code) => down.has(code),
    wasPressed: (code) => pressed.has(code),
    onPointerDown: (fn) => pointerDownHandlers.push(fn),
    endFrame: () => pressed.clear(),
  };
}
