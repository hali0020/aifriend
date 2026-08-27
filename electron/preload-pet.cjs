const { contextBridge, ipcRenderer } = require("electron");

const EDGE_STATE_CHANNEL = "desktop-pet:edge-state";
const EDGE_STATES = new Set(["none", "moving", "top", "bottom", "left", "right"]);

function onEdgeState(listener) {
  if (typeof listener !== "function") throw new TypeError("onEdgeState listener must be a function");
  let subscribed = true;
  const wrapped = (_event, state) => {
    if (subscribed && typeof state === "string" && EDGE_STATES.has(state)) listener(state);
  };
  ipcRenderer.on(EDGE_STATE_CHANNEL, wrapped);
  return () => {
    if (!subscribed) return;
    subscribed = false;
    ipcRenderer.removeListener(EDGE_STATE_CHANNEL, wrapped);
  };
}

contextBridge.exposeInMainWorld("desktopPetNative", Object.freeze({
  rendererReady: async () => (await ipcRenderer.invoke("desktop-pet:renderer-ready"))?.ok === true,
  openMain: async () => (await ipcRenderer.invoke("desktop-pet:open-main"))?.ok === true,
  closePet: async () => (await ipcRenderer.invoke("desktop-pet:close"))?.ok === true,
  onEdgeState
}));
