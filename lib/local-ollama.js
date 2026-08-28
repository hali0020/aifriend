const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);

export function normalizeLocalOllamaUrl(value = "http://127.0.0.1:11434") {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("OLLAMA_URL 必须是本机回环地址");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("OLLAMA_URL 只允许无凭据、无路径的本机 127.0.0.1 或 ::1 HTTP 地址");
  }
  return url.origin;
}

export function ensureLoopbackNoProxy(env = process.env) {
  for (const key of ["NO_PROXY", "no_proxy"]) {
    const entries = String(env[key] || "").split(",").map(value => value.trim()).filter(Boolean);
    for (const host of ["localhost", "127.0.0.1", "::1"]) if (!entries.includes(host)) entries.push(host);
    env[key] = entries.join(",");
  }
  return env.NO_PROXY;
}

export function createLocalOllamaRequest(value, { fetchImpl = globalThis.fetch, timeoutMs = 5_000 } = {}) {
  const origin = normalizeLocalOllamaUrl(value);
  if (typeof fetchImpl !== "function") throw new TypeError("fetch adapter is required");
  return async function requestLocalOllama(path, init = {}) {
    const target = new URL(String(path || ""), origin);
    if (target.origin !== origin || !target.pathname.startsWith("/api/") || target.search || target.hash) {
      throw new Error("Ollama 请求路径无效");
    }
    const response = await fetchImpl(target, {
      ...init,
      signal: init.signal || AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Ollama ${response.status}`);
    return response;
  };
}

export function isCatalogModel(value, catalog, kind = "any") {
  const item = Array.isArray(catalog) ? catalog.find(entry => entry?.id === value) : null;
  if (!item) return false;
  if (kind === "vision") return item.vision === true;
  if (kind === "language") return item.vision !== true;
  return true;
}
