// ChatLog - Service Worker (background.js)
// Requerido para: abrir el panel lateral al hacer clic en el ícono de la extensión

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Configuración del panel lateral al instalar la extensión
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    enabled: true,
    path: "panel/index.html"
  });
});