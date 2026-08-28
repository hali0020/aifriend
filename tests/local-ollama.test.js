import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createLocalOllamaRequest, ensureLoopbackNoProxy, isCatalogModel, normalizeLocalOllamaUrl } from "../lib/local-ollama.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("accepts only literal HTTP loopback Ollama origins", () => {
  assert.equal(normalizeLocalOllamaUrl(), "http://127.0.0.1:11434");
  assert.equal(normalizeLocalOllamaUrl("http://127.0.0.1:22000/"), "http://127.0.0.1:22000");
  assert.equal(normalizeLocalOllamaUrl("http://[::1]:11434"), "http://[::1]:11434");
  for (const value of [
    "http://localhost:11434",
    "http://192.168.1.2:11434",
    "https://127.0.0.1:11434",
    "http://user:pass@127.0.0.1:11434",
    "http://127.0.0.1:11434/api",
    "http://127.0.0.1:11434?target=remote",
    "not-a-url",
  ]) assert.throws(() => normalizeLocalOllamaUrl(value), /回环地址|只允许/);
});

test("catalog model validation separates language and vision models", () => {
  const catalog = [{ id: "text:1" }, { id: "vision:1", vision: true }];
  assert.equal(isCatalogModel("text:1", catalog, "language"), true);
  assert.equal(isCatalogModel("text:1", catalog, "vision"), false);
  assert.equal(isCatalogModel("vision:1", catalog, "vision"), true);
  assert.equal(isCatalogModel("cloud:latest", catalog), false);
});

test("local Ollama requests reject redirects before an image body can leave the selected origin", async () => {
  let destinationHits = 0;
  const destination = http.createServer((req, res) => {
    destinationHits += 1;
    req.resume();
    res.end("unexpected");
  });
  const destinationPort = await listen(destination);
  const redirector = http.createServer((req, res) => {
    req.resume();
    res.writeHead(307, { Location: `http://127.0.0.1:${destinationPort}/stolen` });
    res.end();
  });
  const redirectorPort = await listen(redirector);
  try {
    const request = createLocalOllamaRequest(`http://127.0.0.1:${redirectorPort}`);
    await assert.rejects(request("/api/chat", { method: "POST", redirect: "follow", body: "SECRET_IMAGE_BYTES" }));
    assert.equal(destinationHits, 0);
  } finally {
    await Promise.all([
      new Promise(resolve => redirector.close(resolve)),
      new Promise(resolve => destination.close(resolve)),
    ]);
  }
});

test("loopback hosts are added to both proxy bypass environment variables", () => {
  const env = { NO_PROXY: "example.invalid", no_proxy: "" };
  ensureLoopbackNoProxy(env);
  for (const key of ["NO_PROXY", "no_proxy"]) {
    assert.match(env[key], /127\.0\.0\.1/);
    assert.match(env[key], /::1/);
  }
});
