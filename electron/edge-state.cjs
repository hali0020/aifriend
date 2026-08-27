"use strict";

const EDGE_STATES = Object.freeze(["none", "moving", "top", "bottom", "left", "right"]);
const EDGE_STATE_SET = new Set(EDGE_STATES);
const EDGE_PRIORITY = Object.freeze(["top", "bottom", "left", "right"]);
const DEFAULT_EDGE_THRESHOLD = 12;

function isEdgeState(value) {
  return typeof value === "string" && EDGE_STATE_SET.has(value);
}

function readFiniteRect(value) {
  if (!value || typeof value !== "object") return null;
  try {
    const rect = {
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height
    };
    if (!Number.isFinite(rect.x)
      || !Number.isFinite(rect.y)
      || !Number.isFinite(rect.width)
      || !Number.isFinite(rect.height)
      || rect.width <= 0
      || rect.height <= 0
      || !Number.isFinite(rect.x + rect.width)
      || !Number.isFinite(rect.y + rect.height)) return null;
    return rect;
  } catch {
    return null;
  }
}

function classifyEdgeState(bounds, workArea, threshold = DEFAULT_EDGE_THRESHOLD) {
  const safeBounds = readFiniteRect(bounds);
  const safeWorkArea = readFiniteRect(workArea);
  if (!safeBounds || !safeWorkArea) return "none";
  if (!Number.isFinite(threshold) || threshold < 0) return "none";

  const distances = {
    top: Math.abs(safeBounds.y - safeWorkArea.y),
    bottom: Math.abs((safeBounds.y + safeBounds.height) - (safeWorkArea.y + safeWorkArea.height)),
    left: Math.abs(safeBounds.x - safeWorkArea.x),
    right: Math.abs((safeBounds.x + safeBounds.width) - (safeWorkArea.x + safeWorkArea.width))
  };

  let nearestState = "none";
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const state of EDGE_PRIORITY) {
    const distance = distances[state];
    if (distance <= threshold && distance < nearestDistance) {
      nearestState = state;
      nearestDistance = distance;
    }
  }
  return nearestState;
}

module.exports = Object.freeze({
  DEFAULT_EDGE_THRESHOLD,
  EDGE_PRIORITY,
  EDGE_STATES,
  classifyEdgeState,
  isEdgeState
});
