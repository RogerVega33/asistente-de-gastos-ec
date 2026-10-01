"use strict";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("No se pudo configurar el panel lateral", error));
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("No se pudo configurar el panel lateral", error));
});

// Solo se conservan tareas activas. La sesión permite recuperarlas si Chrome
// suspende el service worker mientras espera que termine un archivo.
const DOWNLOAD_TASKS_KEY = "sriActiveDownloadTasks";
let downloadOperations = Promise.resolve();

function withDownloadTasks(operation) {
  const result = downloadOperations.then(async () => {
    const stored = await chrome.storage.session.get(DOWNLOAD_TASKS_KEY);
    const oldestAllowed = Date.now() - 10 * 60 * 1000;
    const tasks = (stored[DOWNLOAD_TASKS_KEY] || []).filter((task) => task.createdAt >= oldestAllowed);
    const value = await operation(tasks);
    await chrome.storage.session.set({ [DOWNLOAD_TASKS_KEY]: tasks });
    return value;
  });
  // Serializar las escrituras evita perder tareas ante eventos simultáneos.
  downloadOperations = result.catch(() => {});
  return result;
}

function notifyDownloadResult(task, state, error = "") {
  const target = task.documentId ? { documentId: task.documentId } : { frameId: task.frameId };
  return chrome.tabs.sendMessage(task.tabId, {
    type: "SRI_DOWNLOAD_RESULT", taskId: task.taskId, state, error
  }, target).catch(() => {}); // La pestaña puede haberse cerrado o recargado.
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SRI_DOWNLOAD_PREPARE") {
    if (!Number.isInteger(sender.tab?.id)) {
      sendResponse({ ok: false, error: "No se pudo identificar la pestaña de descarga." });
      return false;
    }
    withDownloadTasks((tasks) => {
      const taskId = crypto.randomUUID();
      tasks.push({
        taskId,
        filename: String(message.filename || "Comprobante"),
        state: "waiting",
        downloadId: null,
        tabId: sender.tab.id,
        frameId: sender.frameId ?? 0,
        documentId: sender.documentId,
        createdAt: Date.now()
      });
      return { ok: true, taskId };
    }).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SRI_DOWNLOAD_CANCEL_TASK") {
    withDownloadTasks((tasks) => {
      const index = tasks.findIndex((task) => task.taskId === message.taskId);
      if (index >= 0) tasks.splice(index, 1);
      return { ok: true };
    }).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const belongsToSri = [item.finalUrl, item.url, item.referrer].filter(Boolean).some((url) => {
    try {
      const hostname = new URL(url).hostname;
      return hostname === "srienlinea.sri.gob.ec" || hostname.endsWith(".sri.gob.ec");
    } catch (_error) {
      return false;
    }
  });
  if (!belongsToSri) return;

  withDownloadTasks((tasks) => {
    const task = tasks.find((candidate) => candidate.state === "waiting");
    if (!task) return undefined;
    task.downloadId = item.id;
    task.state = "downloading";
    return { filename: task.filename, conflictAction: "uniquify" };
  }).then(suggest, (error) => {
    console.error("No se pudo preparar el nombre de la descarga", error);
    suggest();
  });
  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  const completed = delta.state?.current === "complete";
  const interrupted = delta.state?.current === "interrupted" || Boolean(delta.error?.current);
  if (!completed && !interrupted) return;
  withDownloadTasks((tasks) => {
    const index = tasks.findIndex((task) => task.downloadId === delta.id);
    if (index < 0) return null;
    const task = tasks[index];
    tasks.splice(index, 1);
    return task;
  }).then((task) => {
    if (!task) return;
    // La tarea ya quedó retirada de la sesión. El envío no mantiene bloqueadas
    // las siguientes descargas ni su cancelación si la pestaña deja de responder.
    notifyDownloadResult(task, interrupted ? "error" : "complete",
      interrupted ? delta.error?.current || "La descarga fue interrumpida." : "");
  }).catch((error) => console.error("No se pudo procesar el resultado de la descarga", error));
});
