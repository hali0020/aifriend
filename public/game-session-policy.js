export function acceptsGameWindowSurface(displaySurface, electronHostPage = false) {
  if (displaySurface === "window") return true;
  return electronHostPage === true && (displaySurface === undefined || displaySurface === "");
}

export function shouldSkipAutomaticFrame({
  automatic,
  difference,
  skippedFrames = 0,
  lastAnalyzedAt = 0,
  now = Date.now(),
  intervalSeconds = 60,
  threshold = 3.5,
  maxSkippedFrames = 3,
} = {}) {
  if (automatic !== true || !Number.isFinite(difference) || difference >= threshold) return false;
  if (skippedFrames >= maxSkippedFrames) return false;
  const analyzedAt = Number(new Date(lastAnalyzedAt));
  if (!Number.isFinite(analyzedAt) || analyzedAt <= 0) return false;
  const maxQuietMs = Math.max(90_000, Math.min(360_000, Number(intervalSeconds || 60) * 3_000));
  return now - analyzedAt < maxQuietMs;
}

export function historyForGameRequest(history, game) {
  return game?.enabled === true ? [] : Array.isArray(history) ? history : [];
}

export function isGameSessionRequest(origin, game) {
  return game?.enabled === true || String(origin || "").startsWith("game");
}
