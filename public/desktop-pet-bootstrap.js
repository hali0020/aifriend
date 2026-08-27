(() => {
  let timer = 0;

  function panel() {
    let root = document.querySelector("#petBoot");
    if (root) return root;
    root = document.createElement("main");
    root.className = "pet-boot";
    root.id = "petBoot";
    root.setAttribute("role", "alert");
    root.innerHTML = '<strong id="petBootTitle"></strong><span id="petBootDetail"></span><button id="petBootMain" type="button">打开主界面</button>';
    document.body.replaceChildren(root);
    return root;
  }

  function bindMainButton() {
    document.querySelector("#petBootMain")?.addEventListener("click", () => window.desktopPetNative?.openMain?.(), { once: true });
  }

  function fail(detail = "桌宠界面没有完成加载，请打开主界面重试。") {
    clearTimeout(timer);
    panel();
    const title = document.querySelector("#petBootTitle");
    const message = document.querySelector("#petBootDetail");
    if (title) title.textContent = "桌宠启动失败";
    if (message) message.textContent = String(detail || "界面加载失败").slice(0, 180);
    bindMainButton();
  }

  function complete() {
    clearTimeout(timer);
    document.querySelector("#petBoot")?.remove();
  }

  bindMainButton();
  window.addEventListener("error", event => fail(event.error?.message || event.message || "桌宠脚本加载失败。"));
  window.addEventListener("unhandledrejection", event => fail(event.reason?.message || "桌宠脚本执行失败。"));
  timer = window.setTimeout(() => fail("桌宠界面加载超时，请打开主界面重试。"), 12_000);
  window.desktopPetBoot = Object.freeze({ complete, fail });
})();
