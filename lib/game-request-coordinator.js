export function createGameRequestCoordinator() {
  let epoch = 0;
  let activeStops = 0;

  return Object.freeze({
    capture() {
      return epoch;
    },
    beginStop() {
      epoch += 1;
      activeStops += 1;
    },
    endStop() {
      activeStops = Math.max(0, activeStops - 1);
    },
    canClaim(requestEpoch, controller) {
      return activeStops === 0 && requestEpoch === epoch && controller?.signal?.aborted !== true;
    },
    isStopping() {
      return activeStops > 0;
    },
  });
}

export function readRequestGameEnabled(data) {
  const game = data?.game;
  if (game === undefined || game === null) return false;
  if (typeof game !== "object" || Array.isArray(game)) throw new SyntaxError("game 必须是对象");
  if (!Object.hasOwn(game, "enabled")) return false;
  if (typeof game.enabled !== "boolean") throw new SyntaxError("game.enabled 必须是布尔值");
  return game.enabled;
}
