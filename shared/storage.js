// ハイスコアなどを localStorage に保存する。
// プライベートモードなどで使えない場合でもゲームが止まらないよう try/catch で包む。
const PREFIX = '100games:';

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 保存できなくても続行
  }
}

// スコアが更新されたら保存して true を返す
export function saveHighScore(gameId, score) {
  const best = load(`${gameId}:best`, 0);
  if (score > best) {
    save(`${gameId}:best`, score);
    return true;
  }
  return false;
}

export function loadHighScore(gameId) {
  return load(`${gameId}:best`, 0);
}
