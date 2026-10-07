"use strict";

(() => {
  const shared = globalThis.SriShared;
  const csv = globalThis.SriCsv;
  const elements = {
    fileInput: document.querySelector("#csv-file"),
    fileName: document.querySelector("#file-name"),
    fileSummary: document.querySelector("#file-summary"),
    fileError: document.querySelector("#file-error"),
    clearFile: document.querySelector("#clear-file"),
    refreshPage: document.querySelector("#refresh-page"),
    pagePlaceholder: document.querySelector("#page-placeholder"),
    pageSummary: document.querySelector("#page-summary"),
    pageError: document.querySelector("#page-error"),
    providerRuc: document.querySelector("#provider-ruc"),
    currentPage: document.querySelector("#current-page"),
    visibleCount: document.querySelector("#visible-count"),
    matchSummary: document.querySelector("#match-summary"),
    resultsBody: document.querySelector("#results-body"),
    fillButton: document.querySelector("#fill-page"),
    actionMessage: document.querySelector("#action-message")
  };

  let dataset = null;
  let currentPage = null;
  let currentAnalysis = null;
  let filling = false;
  let refreshAfterFill = false;
  let refreshSequence = 0;
  let actionMessageText = "";
  let actionMessageKind = "";

  function renderActionMessage() {
    const hasDifferences = !!currentAnalysis?.warnings.length;
    const text = actionMessageText || (hasDifferences
      ? "Se actualizó la página visible. Revise las coincidencias."
      : "");
    const note = hasDifferences ? "* Los campos completados difieren del CSV" : "";
    const kind = hasDifferences && !filling && actionMessageKind !== "error"
      ? "info"
      : actionMessageKind;
    elements.actionMessage.textContent = [text, note].filter(Boolean).join("\n");
    elements.actionMessage.className = `message ${kind}`.trim();
    elements.actionMessage.hidden = !text && !note;
  }

  function setMessage(element, text = "", kind = "") {
    if (element === elements.actionMessage) {
      actionMessageText = text;
      actionMessageKind = kind;
      renderActionMessage();
      return;
    }
    element.textContent = text;
    element.className = `message ${kind}`.trim();
    element.hidden = !text;
  }

  function metrics(items) {
    return items
      .map(
        (item) =>
          `<div class="metric ${item.kind || ""}"><strong>${item.value}</strong><span>${item.label}</span></div>`
      )
      .join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No se encontró una pestaña activa.");
    return tab;
  }

  async function sendToActiveTab(message) {
    const tab = await activeTab();
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (_error) {
      throw new Error("Abra o recargue la página de facturas del SRI.");
    }
  }

  function renderFile() {
    if (!dataset) {
      elements.fileName.textContent = "Ningún archivo cargado";
      elements.fileSummary.hidden = true;
      elements.clearFile.hidden = true;
      return;
    }
    elements.fileName.textContent = dataset.fileName;
    elements.clearFile.hidden = false;
    elements.fileSummary.hidden = false;
    elements.fileSummary.innerHTML = metrics([
      { value: dataset.rows.length, label: "Registros", kind: "ready" },
      { value: new Set(dataset.rows.map((row) => row.ruc)).size, label: "Proveedores" },
      { value: dataset.delimiter === "," ? "coma" : dataset.delimiter, label: "Separador" }
    ]);
  }

  function analyzePage(page) {
    const byInvoice = new Map();
    if (dataset) {
      for (const row of dataset.rows) {
        if (row.ruc === page.ruc) byInvoice.set(row.invoice, row);
      }
    }

    const results = page.invoices.map((invoice) => {
      const row = byInvoice.get(invoice.invoice);
      if (!row) return { invoice, state: "skip", label: "No está en el CSV", row: null };
      const matchesCsv = shared.CATEGORY_DEFINITIONS.every(
        (category) => invoice.values[category.key] === row.values[category.key]
      );
      if (row.totalCents === 0 && matchesCsv) {
        return { invoice, state: "found", label: "Encontrada, sin deducibles", row };
      }
      if (invoice.missingFields.length) {
        return { invoice, state: "error", label: "Faltan campos en el formulario", row };
      }
      if (matchesCsv) {
        return { invoice, state: "equal", label: "Campos completados", row };
      }
      const exceedsMaximum = invoice.availableTotalCents !== null &&
        shared.projectedTotalCents(invoice.values, row.values) > invoice.availableTotalCents;
      const needsFill = !shared.specifiedValuesEqual(invoice.values, row.values);
      const hasFilledValues = shared.CATEGORY_DEFINITIONS.some(
        (category) => Number.isInteger(invoice.values[category.key]) && invoice.values[category.key] > 0
      );
      if (!needsFill || hasFilledValues) {
        return {
          invoice, state: "warning", label: "Campos completados*", row,
          needsFill: needsFill && !exceedsMaximum
        };
      }
      if (exceedsMaximum) {
        return { invoice, state: "error", label: "Supera el máximo disponible", row };
      }
      return { invoice, state: "ready", label: "Lista para llenar", row };
    });

    return {
      results,
      ready: results.filter((result) =>
        result.state === "ready" || (result.state === "warning" && result.needsFill)
      ),
      equal: results.filter((result) => result.state === "equal"),
      found: results.filter((result) => result.state === "found"),
      warnings: results.filter((result) => result.state === "warning"),
      errors: results.filter((result) => result.state === "error")
    };
  }

  function renderPage() {
    if (!currentPage?.ok) {
      currentAnalysis = null;
      elements.pagePlaceholder.hidden = false;
      elements.pageSummary.hidden = true;
      elements.resultsBody.innerHTML =
        '<tr><td colspan="3" class="empty-row">Aún no hay datos para comparar.</td></tr>';
      elements.fillButton.disabled = true;
      elements.fillButton.textContent = "Llenar página actual";
      renderActionMessage();
      return;
    }

    elements.pagePlaceholder.hidden = true;
    elements.pageSummary.hidden = false;
    elements.providerRuc.textContent = currentPage.ruc;
    elements.currentPage.textContent = currentPage.pageNumber;
    elements.visibleCount.textContent = currentPage.invoices.length;

    currentAnalysis = analyzePage(currentPage);
    const completedCount = currentAnalysis.equal.length + currentAnalysis.found.length +
      currentAnalysis.warnings.filter((result) => !result.needsFill).length;
    elements.matchSummary.innerHTML = metrics([
      { value: currentAnalysis.ready.length, label: "Por llenar", kind: "ready" },
      { value: completedCount, label: "Sin cambios" },
      { value: currentAnalysis.errors.length, label: "Errores", kind: currentAnalysis.errors.length ? "error" : "" }
    ]);

    elements.resultsBody.innerHTML = currentAnalysis.results
      .map((result) => {
        const total = result.row ? shared.centsToDisplay(result.row.totalCents) : "--";
        return `<tr>
          <td>${escapeHtml(result.invoice.displayInvoice)}</td>
          <td>${escapeHtml(total)}</td>
          <td class="status-${result.state}">${escapeHtml(result.label)}</td>
        </tr>`;
      })
      .join("");

    const readyCount = currentAnalysis.ready.length;
    if (filling) {
      elements.fillButton.textContent = "Llenando facturas...";
    } else if (readyCount > 0) {
      elements.fillButton.textContent =
        readyCount === 1 ? "Llenar 1 factura válida" : `Llenar ${readyCount} facturas válidas`;
    } else if (dataset && completedCount > 0 && currentAnalysis.errors.length === 0) {
      elements.fillButton.textContent = "No hay campos nuevos que llenar";
    } else {
      elements.fillButton.textContent = "Llenar página actual";
    }
    elements.fillButton.disabled = filling || !dataset || readyCount === 0;
    renderActionMessage();
  }

  async function refreshPage({ quiet = false } = {}) {
    const sequence = ++refreshSequence;
    if (!quiet) setMessage(elements.actionMessage);
    setMessage(elements.pageError);
    try {
      const page = await sendToActiveTab({ type: "SRI_READ_PAGE" });
      if (sequence !== refreshSequence) return;
      currentPage = page;
      if (!page?.ok) setMessage(elements.pageError, page?.error || "No se pudo leer la página.", "error");
    } catch (error) {
      if (sequence !== refreshSequence) return;
      currentPage = null;
      setMessage(elements.pageError, error.message, "error");
    }
    renderPage();
  }

  async function loadFile(file) {
    setMessage(elements.fileError);
    setMessage(elements.actionMessage);
    try {
      const parsed = csv.parseCsv(await file.text());
      if (parsed.errors.length) {
        throw new Error(parsed.errors.slice(0, 8).join("\n"));
      }
      dataset = {
        fileName: file.name,
        delimiter: parsed.delimiter,
        rows: parsed.rows
      };
      await chrome.storage.session.set({ sriAssistantDataset: dataset });
      renderFile();
      await refreshPage({ quiet: true });
      setMessage(elements.actionMessage, "CSV cargado. Revise las coincidencias de la página visible.", "info");
    } catch (error) {
      elements.fileInput.value = "";
      setMessage(elements.fileError, error.message, "error");
    }
  }

  async function clearFile() {
    dataset = null;
    currentAnalysis = null;
    elements.fileInput.value = "";
    await chrome.storage.session.remove("sriAssistantDataset");
    renderFile();
    renderPage();
    setMessage(elements.actionMessage, "Archivo retirado de la sesión.", "info");
  }

  async function fillCurrentPage() {
    if (!currentAnalysis?.ready.length || filling) return;
    filling = true;
    renderPage();
    setMessage(elements.actionMessage, "Llenando campos...", "info");

    const requestedRows = currentAnalysis.ready.map(({ row }) => ({
      ruc: row.ruc,
      invoice: row.invoice,
      values: row.values
    }));

    try {
      const response = await sendToActiveTab({ type: "SRI_FILL_PAGE", rows: requestedRows });
      if (!response?.ok) throw new Error(response?.error || "No se pudo completar la página.");
      currentPage = response.page;
      const changedFields = response.results.reduce((sum, result) => sum + result.changedFields, 0);
      setMessage(
        elements.actionMessage,
        `Se llenaron ${response.results.length} factura(s) y ${changedFields} campo(s). Revise los valores y presione Guardar en el SRI.`,
        "success"
      );
    } catch (error) {
      setMessage(
        elements.actionMessage,
        `${error.message} Revise la página antes de guardar; algunos campos pudieron haberse llenado.`,
        "error"
      );
      await refreshPage({ quiet: true });
    } finally {
      filling = false;
      if (refreshAfterFill) {
        refreshAfterFill = false;
        await refreshPage({ quiet: true });
      }
      renderPage();
    }
  }

  elements.fileInput.addEventListener("change", () => {
    const [file] = elements.fileInput.files;
    if (file) loadFile(file);
  });
  elements.clearFile.addEventListener("click", clearFile);
  elements.refreshPage.addEventListener("click", () => refreshPage());
  elements.fillButton.addEventListener("click", fillCurrentPage);

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "SRI_VISIBLE_PAGE_CHANGED") return;
    // Un proveedor abierto en otra pestaña no debe cambiar este análisis.
    activeTab().then((tab) => {
      if (sender.tab?.id !== tab.id) return;
      if (filling) {
        refreshAfterFill = true;
        return;
      }
      setMessage(elements.actionMessage, "Se actualizó la página visible. Revise las coincidencias.", "info");
      refreshPage({ quiet: true });
    }).catch(() => {});
  });

  async function initialize() {
    const stored = await chrome.storage.session.get("sriAssistantDataset");
    dataset = stored.sriAssistantDataset || null;
    renderFile();
    await refreshPage({ quiet: true });
  }

  initialize().catch((error) => setMessage(elements.pageError, error.message, "error"));

  window.addEventListener("sri-mode-changed", (event) => {
    if (event.detail?.mode === "fill") refreshPage({ quiet: true });
  });
})();
