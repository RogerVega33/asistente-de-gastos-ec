"use strict";

(() => {
  const shared = globalThis.SriDownloadShared;
  const PREFIX = "frmPrincipal:tablaCompRecibidos";
  const SEARCH_BUTTON_IDS = ["frmPrincipal:btnConsultarSinRe", "frmPrincipal:btnBuscar"];
  const TIMEOUT_MS = 25_000;
  const DOWNLOAD_TIMEOUT_MS = 90_000;
  const DOCUMENT_TYPES = [
    { value: "1", label: "Factura" },
    { value: "2", label: "Liquidación de compra" },
    { value: "3", label: "Nota de crédito" },
    { value: "4", label: "Nota de débito" },
    { value: "6", label: "Comprobante de retención" }
  ];

  let running = false;
  let cancelRequested = false;
  let pendingDownload = null;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function ensureNotCancelled() {
    if (cancelRequested) throw new Error("Descarga cancelada por el usuario.");
  }

  async function waitFor(
    predicate,
    timeout = TIMEOUT_MS,
    interval = 150,
    timeoutMessage = "El SRI no respondió dentro del tiempo esperado."
  ) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      ensureNotCancelled();
      const result = predicate();
      if (result) return result;
      await sleep(interval);
    }
    throw new Error(timeoutMessage);
  }

  async function waitForDomUpdate(action, timeout = TIMEOUT_MS) {
    const root = document.querySelector("#frmPrincipal") || document.body;
    let lastMutation = 0;
    let observed = false;
    const observer = new MutationObserver(() => {
      observed = true;
      lastMutation = Date.now();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    action();

    const startedAt = Date.now();
    try {
      while (Date.now() - startedAt < timeout) {
        ensureNotCancelled();
        if (observed && Date.now() - lastMutation >= 450) return;
        await sleep(100);
      }
    } finally {
      observer.disconnect();
    }
    throw new Error("El formulario del SRI no terminó de actualizarse.");
  }

  function setSelectValue(id, value) {
    const select = document.getElementById(id);
    if (!select) throw new Error(`No se encontró el campo ${id}.`);
    const option = Array.from(select.options).find((item) => item.value === String(value));
    if (!option) throw new Error(`El SRI no ofrece el valor ${value} en ${id}.`);
    select.value = String(value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function searchButton() {
    return SEARCH_BUTTON_IDS.map((id) => document.getElementById(id)).find(
      (element) => element && !element.disabled
    );
  }

  function downloadFormReady() {
    return Boolean(
      document.getElementById("frmPrincipal:ano") &&
        document.getElementById("frmPrincipal:mes") &&
        document.getElementById("frmPrincipal:dia") &&
        document.getElementById("frmPrincipal:cmbTipoComprobante") &&
        searchButton()
    );
  }

  function warningSnapshot() {
    const node = document.querySelector(
      "#formMessages\\:messages .ui-messages-warn-summary, " +
        "#formMessages\\:messages .ui-messages-info-summary, " +
        "#formMessages\\:messages .ui-messages-error-summary"
    );
    return { node, text: node?.textContent.trim() || "" };
  }

  function resultRows() {
    const links = document.querySelectorAll(
      `a[id^="${PREFIX}:"][id$=":lnkXml"], a[id^="${PREFIX}:"][id$=":lnkPdf"]`
    );
    return Array.from(new Set(Array.from(links, (link) => link.closest("tr")).filter(Boolean)));
  }

  function resultSignature(rows) {
    const identifiers = rows.map((row) => {
      const authorization = row.querySelector("td:nth-child(4)")?.textContent.replace(/\s/g, "");
      if (authorization && /^\d+$/.test(authorization)) return authorization;

      const issuer = row.querySelector("td:nth-child(2)")?.textContent.match(/\b\d{13}\b/)?.[0];
      const documentName = row.querySelector("td:nth-child(3)")?.textContent.trim().replace(/\s+/g, " ");
      return issuer && shared.invoiceFromText(documentName) ? `${issuer}:${documentName}` : "";
    });
    // Reordenar los mismos comprobantes no constituye una página nueva.
    return identifiers.length && identifiers.every(Boolean) ? identifiers.sort().join("|") : "";
  }

  function currentPageNumber() {
    const paginator = document.getElementById(`${PREFIX}_paginator_bottom`);
    const indicator = paginator?.querySelector(".ui-paginator-page.ui-state-active") ||
      paginator?.querySelector(".ui-paginator-current");
    const number = Number(indicator?.textContent.match(/\d+/)?.[0]);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function notify(type, detail = {}) {
    chrome.runtime.sendMessage({ type, ...detail }).catch(() => {});
  }

  async function waitForQueryResult(previous, period) {
    return waitFor(() => {
      const warning = warningSnapshot();
      const newWarning = warning.text &&
        (warning.node !== previous.warning.node || warning.text !== previous.warning.text);
      if (newWarning) return { rows: [], warning: warning.text };

      const rows = resultRows();
      if (!rows.length) return null;

      const signature = resultSignature(rows);
      const tableWasUpdated = rows[0] !== previous.firstRow ||
        (signature && signature !== previous.signature);
      return tableWasUpdated ? { rows, warning: "" } : null;
    }, TIMEOUT_MS, 150,
    `No se pudo confirmar la consulta de ${period.value}.`);
  }

  async function queryPeriod(period, documentType) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      ensureNotCancelled();
      notify("SRI_DOWNLOAD_PROGRESS", {
        phase: "query",
        period: period.value,
        message: `Consultando ${period.value} - ${documentType.label}...`
      });

      setSelectValue("frmPrincipal:ano", period.year);
      setSelectValue("frmPrincipal:mes", period.month);
      setSelectValue("frmPrincipal:dia", "0");
      setSelectValue("frmPrincipal:cmbTipoComprobante", documentType.value);

      const button = await waitFor(searchButton);
      const previousRows = resultRows();
      const previous = {
        firstRow: previousRows[0],
        signature: resultSignature(previousRows),
        warning: warningSnapshot()
      };
      button.click();
      const result = await waitForQueryResult(previous, period);
      const warning = result.warning;
      if (/aptcha/i.test(warning)) {
        if (attempt === 3) throw new Error("El SRI rechazó el captcha tres veces consecutivas.");
        notify("SRI_DOWNLOAD_PROGRESS", {
          phase: "captcha",
          period: period.value,
          message: `${documentType.label}: captcha rechazado; reintentando (${attempt}/3)...`
        });
        await sleep(1500);
        continue;
      }

      return result.rows.length;
    }
    return 0;
  }

  async function maximizeRowsPerPage() {
    const select = document.querySelector(
      "td#frmPrincipal\\:tablaCompRecibidos_paginator_bottom select.ui-paginator-rpp-options"
    );
    if (!select?.options?.length) return;
    const maximum = Math.max(...Array.from(select.options, (option) => Number(option.value) || 0));
    if (!maximum || select.value === String(maximum)) return;
    await waitForDomUpdate(() => {
      select.value = String(maximum);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function rowBaseName(row) {
    const nameCell = row.querySelector("td:nth-child(3) div");
    const invoice = shared.invoiceFromText(row.textContent);
    const rawName = nameCell?.textContent.trim() || (invoice ? `Factura ${invoice}` : "Comprobante");
    return shared.documentBaseName(rawName);
  }

  async function prepareDownload(filename) {
    const response = await chrome.runtime.sendMessage({ type: "SRI_DOWNLOAD_PREPARE", filename });
    if (!response?.ok) throw new Error(response?.error || "No se pudo preparar la descarga.");
    return response.taskId;
  }

  function waitForDownload(taskId, start) {
    return new Promise((resolve, reject) => {
      ensureNotCancelled();
      const finish = (error) => {
        clearTimeout(timer);
        pendingDownload = null;
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error("Chrome no confirmó la descarga del archivo.")),
        DOWNLOAD_TIMEOUT_MS
      );
      // Registrar la espera antes del clic también cubre descargas inmediatas.
      pendingDownload = { taskId, finish };
      try {
        start();
      } catch (error) {
        finish(error);
      }
    });
  }

  async function downloadLink(link, filename) {
    const taskId = await prepareDownload(filename);
    try {
      await waitForDownload(taskId, () => {
        link.scrollIntoView({ block: "center" });
        link.click();
      });
    } catch (error) {
      // La limpieza es secundaria: un service worker suspendido no debe impedir
      // que la cancelación o el error lleguen al panel.
      chrome.runtime.sendMessage({ type: "SRI_DOWNLOAD_CANCEL_TASK", taskId }).catch(() => {});
      throw error;
    }
  }

  async function downloadCurrentPage(options, state) {
    const rows = resultRows();
    for (let index = 0; index < rows.length; index += 1) {
      ensureNotCancelled();
      const row = rows[index];
      const baseName = rowBaseName(row);
      notify("SRI_DOWNLOAD_PROGRESS", {
        phase: "download",
        period: state.period,
        page: state.page,
        row: index + 1,
        rows: rows.length,
        filesDownloaded: state.filesDownloaded,
        message: `${state.period} - página ${state.page}, comprobante ${index + 1} de ${rows.length}`
      });

      if (options.xml) {
        const xmlLink = row.querySelector(`a[id$=":lnkXml"]`);
        if (!xmlLink) throw new Error(`No se encontró el XML de ${baseName}.`);
        await downloadLink(xmlLink, `${baseName}.xml`);
        state.filesDownloaded += 1;
      }
      if (options.pdf) {
        const pdfLink = row.querySelector(`a[id$=":lnkPdf"]`);
        if (!pdfLink) throw new Error(`No se encontró el PDF de ${baseName}.`);
        await downloadLink(pdfLink, `${baseName}.pdf`);
        state.filesDownloaded += 1;
      }
      state.documentsDownloaded += 1;
    }
    return rows.length;
  }

  function nextButton() {
    return document.querySelector(
      "td#frmPrincipal\\:tablaCompRecibidos_paginator_bottom span.ui-paginator-next"
    );
  }

  async function goToNextPage() {
    const button = nextButton();
    if (!button || button.classList.contains("ui-state-disabled")) return false;

    const previousPage = currentPageNumber();
    const previousSignature = resultSignature(resultRows());
    if (!previousPage || !previousSignature) {
      throw new Error("No se pudo identificar la página o sus comprobantes. Se detuvo la descarga.");
    }
    const expectedPage = previousPage + 1;
    button.click();
    await waitFor(() => {
      if (currentPageNumber() !== expectedPage) return false;
      const signature = resultSignature(resultRows());
      return signature && signature !== previousSignature;
    }, TIMEOUT_MS, 150,
    `No se pudo confirmar la página ${expectedPage} con comprobantes diferentes. Se detuvo la descarga para evitar repetir comprobantes.`);
    return true;
  }

  async function runDownload(request) {
    const periods = shared.monthRange(request.from, request.to);
    const documentType = DOCUMENT_TYPES.find(
      (type) => type.value === String(request.documentType || "1")
    );
    if (!documentType) throw new Error("Seleccione un tipo de comprobante válido.");
    const state = { filesDownloaded: 0, documentsDownloaded: 0, period: "", page: 1 };

    for (const period of periods) {
      ensureNotCancelled();
      state.period = period.value;
      state.page = 1;
      const rowCount = await queryPeriod(period, documentType);
      if (!rowCount) {
        notify("SRI_DOWNLOAD_PROGRESS", {
          phase: "empty",
          period: period.value,
          filesDownloaded: state.filesDownloaded,
          message: `${period.value} - ${documentType.label}: no se encontraron comprobantes.`
        });
        continue;
      }

      await maximizeRowsPerPage();
      while (true) {
        const processed = await downloadCurrentPage(request, state);
        if (!processed || !(await goToNextPage())) break;
        state.page += 1;
      }
    }

    return state;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SRI_DOWNLOAD_RESULT") {
      if (!pendingDownload || message.taskId !== pendingDownload.taskId) return false;
      if (message.state === "complete") pendingDownload.finish();
      else if (message.state === "error") {
        pendingDownload.finish(new Error(message.error || "La descarga fue interrumpida."));
      }
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "SRI_DOWNLOAD_PING") {
      if (!downloadFormReady()) return false;
      sendResponse({ ok: true, running, ready: true });
      return false;
    }
    if (message?.type === "SRI_DOWNLOAD_CANCEL") {
      if (!running) return false;
      cancelRequested = true;
      pendingDownload?.finish(new Error("Descarga cancelada por el usuario."));
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "SRI_DOWNLOAD_START") {
      if (!downloadFormReady()) return false;
      if (running) {
        sendResponse({ ok: false, error: "Ya existe una descarga en curso." });
        return false;
      }
      running = true;
      cancelRequested = false;
      sendResponse({ ok: true });
      runDownload(message)
        .then((state) => {
          notify("SRI_DOWNLOAD_FINISHED", {
            ok: true,
            filesDownloaded: state.filesDownloaded,
            documentsDownloaded: state.documentsDownloaded
          });
        })
        .catch((error) => {
          notify("SRI_DOWNLOAD_FINISHED", { ok: false, error: error.message });
        })
        .finally(() => {
          running = false;
          cancelRequested = false;
        });
      return false;
    }
    return false;
  });
})();
