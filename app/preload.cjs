/**
 * Bridge for the one native capability the renderer needs: PDF export.
 * window.print() in Electron goes through the OS print pipeline, which
 * rasterizes pages (no text layer); webContents.printToPDF renders real
 * selectable text with embedded fonts.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("careerNodes", {
  /** Returns the saved path, or null when the user cancels the dialog. */
  exportPdf: (suggestedName) => ipcRenderer.invoke("cc-export-pdf", suggestedName),
});
