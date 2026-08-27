import { createDesktopPet } from "/desktop-pet.js";

const nativeApi = window.desktopPetNative;
let desktopPet = null;
let unsubscribeEdgeState = null;

function disposeDesktopPet() {
  unsubscribeEdgeState?.();
  unsubscribeEdgeState = null;
  desktopPet?.dispose();
  desktopPet = null;
}

try {
  desktopPet = createDesktopPet({
    role: "pet",
    avatarUrl: "/christina-avatar.webp",
    onOpenMain: () => nativeApi?.openMain?.(),
    onNativeClose: () => nativeApi?.closePet?.()
  });
  if (typeof nativeApi?.onEdgeState === "function" && typeof desktopPet.setEdgeState === "function") {
    const unsubscribe = nativeApi.onEdgeState(state => desktopPet?.setEdgeState(state));
    if (typeof unsubscribe === "function") unsubscribeEdgeState = unsubscribe;
  }
  desktopPet.mountNative();
  const shell = document.querySelector(".pet-shell");
  if (!shell || shell.getBoundingClientRect().width < 1 || shell.getBoundingClientRect().height < 1) throw new Error("桌宠界面没有生成可见内容。");
  if (nativeApi?.rendererReady && !await nativeApi.rendererReady()) throw new Error("主进程拒绝了桌宠就绪信号。");
  window.desktopPetBoot?.complete();
  window.addEventListener("beforeunload", disposeDesktopPet, { once: true });
} catch (error) {
  disposeDesktopPet();
  window.desktopPetBoot?.fail(error?.message || "桌宠界面初始化失败。");
  throw error;
}
