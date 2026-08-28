"use strict";

function finiteRect(value) {
  if (!value || typeof value !== "object") return null;
  const rect = {};
  for (const key of ["x", "y", "width", "height"]) {
    const item = value[key];
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    rect[key] = item;
  }
  if (rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

function nextPetRoamBounds(boundsValue, workAreaValue, randomX = 0.5, randomY = 0.5) {
  const bounds = finiteRect(boundsValue);
  const workArea = finiteRect(workAreaValue);
  if (!bounds || !workArea || bounds.width > workArea.width || bounds.height > workArea.height) return null;
  if (![randomX, randomY].every(value => typeof value === "number" && Number.isFinite(value))) return null;
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const unit = value => clamp(value, 0, 1);
  const minimumX = workArea.x;
  const maximumX = workArea.x + workArea.width - bounds.width;
  const minimumY = workArea.y;
  const maximumY = workArea.y + workArea.height - bounds.height;
  const x = clamp(bounds.x + (unit(randomX) * 2 - 1) * Math.min(240, workArea.width * 0.22), minimumX, maximumX);
  const y = clamp(bounds.y + (unit(randomY) * 2 - 1) * Math.min(120, workArea.height * 0.14), minimumY, maximumY);
  return Object.freeze({ x: Math.round(x), y: Math.round(y), width: bounds.width, height: bounds.height });
}

function sameBounds(left, right) {
  const a = finiteRect(left);
  const b = finiteRect(right);
  return !!a && !!b && ["x", "y", "width", "height"].every(key => a[key] === b[key]);
}

function createPetRoamMoveGuard({ now = Date.now, holdMs = 1500 } = {}) {
  if (typeof now !== "function") throw new TypeError("pet roam clock must be callable");
  if (typeof holdMs !== "number" || !Number.isFinite(holdMs) || holdMs < 100) {
    throw new TypeError("pet roam hold time is invalid");
  }
  let expected = null;
  let expiresAt = 0;

  function pending() {
    if (!expected) return false;
    const current = now();
    if (typeof current !== "number" || !Number.isFinite(current) || current >= expiresAt) {
      expected = null;
      expiresAt = 0;
      return false;
    }
    return true;
  }

  function mark(boundsValue) {
    const bounds = finiteRect(boundsValue);
    const current = now();
    if (!bounds || typeof current !== "number" || !Number.isFinite(current)) return false;
    expected = Object.freeze({ ...bounds });
    expiresAt = current + holdMs;
    return true;
  }

  function isProgrammatic(boundsValue) {
    if (!pending()) return false;
    return boundsValue === undefined ? true : sameBounds(boundsValue, expected);
  }

  function consume(boundsValue) {
    const matched = isProgrammatic(boundsValue);
    if (matched) reset();
    return matched;
  }

  function reset() {
    expected = null;
    expiresAt = 0;
  }

  return Object.freeze({ mark, isProgrammatic, consume, reset });
}

module.exports = Object.freeze({ createPetRoamMoveGuard, nextPetRoamBounds });
