// Chrome abre el panel desde el icono sin esperar a nuestro manejador de clic.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
    .catch(error => console.error('No se pudo configurar el panel de ChatLog:', error));
