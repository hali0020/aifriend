const PROCESSING_MODES = new Set(["local", "cloud", "demo", "cloud-offline", "offline"]);

export function buildStatusView(status) {
  if (!status || typeof status !== "object" || !PROCESSING_MODES.has(status.processing)) {
    throw new TypeError("运行状态响应无效");
  }
  const model = String(status.model || "未知模型").slice(0, 120);
  const statusText = status.processing === "local" ? `本地 · ${model}`
    : status.processing === "cloud" ? `云端 · ${model}`
      : status.processing === "demo" ? "演示模式 · 可直接体验"
        : status.processing === "cloud-offline" ? "云端模式 · 凭据未配置"
          : "仅本地 · Ollama 未就绪";
  const privacyText = status.processing === "cloud" ? "☁️ 云端模式 · 对话会发送给所选云服务"
    : status.processing === "cloud-offline" ? "☁️ 云端模式未配置 · 当前不会发送内容"
      : "🔒 本地优先 · 不会自动回退云端";
  const imageGate = status.imageSemantic?.ready ? "本地图像语义门已就绪" : "本地图像语义门未就绪";
  const remoteEnabled = status.safety?.remoteEnabled === true;
  const remoteReady = status.safety?.remoteReady === true;
  const safetyText = remoteEnabled
    ? remoteReady
      ? `本地文本输入/输出检查 · ${imageGate} · 可选 OpenAI 远程复核已启用`
      : `本地文本输入/输出检查 · ${imageGate} · 可选远程复核配置不完整`
    : `本地文本输入/输出检查 · ${imageGate} · 可选远程复核未启用`;
  const safetyMode = remoteEnabled
    ? remoteReady && status.imageSemantic?.ready ? "remote" : "error"
    : status.imageSemantic?.ready ? "local" : "error";
  return { statusText, privacyText, safetyText, safetyMode };
}

export function unavailableStatusView() {
  return {
    statusText: "本地服务未连接",
    privacyText: "⚠️ 处理模式暂时无法确认",
    safetyText: "安全状态暂时无法确认",
    safetyMode: "error",
  };
}
