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
