const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPetNative", Object.freeze({
  togglePet: async forceVisible => {
    if (forceVisible !== undefined && typeof forceVisible !== "boolean") return false;
    const result = await ipcRenderer.invoke("desktop-pet:toggle", forceVisible);
    return result?.ok === true && result.open === true;
  },
  onPetVisibility: callback => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, visible) => callback(visible === true);
    ipcRenderer.on("desktop-pet:visibility", listener);
    return () => ipcRenderer.removeListener("desktop-pet:visibility", listener);
  },
  trashDesktopFile: async () => {
    const result = await ipcRenderer.invoke("desktop-pet:trash-file");
    const allowed = new Set(["trashed", "cancelled", "busy", "invalid", "changed", "failed", "forbidden"]);
    const status = allowed.has(result?.status) ? result.status : "failed";
    return Object.freeze({ ok: result?.ok === true && ["trashed", "cancelled"].includes(status), status });
  }
}));
