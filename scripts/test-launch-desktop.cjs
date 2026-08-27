const assert = require("node:assert/strict");
const { isCodexSandboxAccount, samUserName } = require("./launch-desktop.cjs");

assert.equal(samUserName("EXAMPLE\\ordinary.user"), "ordinary.user");
assert.equal(samUserName("ordinary.user"), "ordinary.user");
assert.equal(samUserName("DOMAIN/codexsandboxoffline"), "codexsandboxoffline");
assert.equal(isCodexSandboxAccount("EXAMPLE\\codexsandboxoffline"), true);
assert.equal(isCodexSandboxAccount("codexsandbox"), true);
assert.equal(isCodexSandboxAccount("codexsandbox-test"), true);
assert.equal(isCodexSandboxAccount("codexsandbox.example\\ordinary.user"), false);
assert.equal(isCodexSandboxAccount("DOMAIN\\mycodexsandbox"), false);
assert.equal(isCodexSandboxAccount(""), false);

console.log("desktop launcher policy: ok");
