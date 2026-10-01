"use strict";

(() => {
  const shared = globalThis.SriDownloadShared;
  const elements = {
    fromMonth: document.querySelector("#download-from-month"),
    fromYear: document.querySelector("#download-from-year"),
    toMonth: document.querySelector("#download-to-month"),
    toYear: document.querySelector("#download-to-year"),
    fromMonthToggle: document.querySelector("#download-from-month-toggle"),
    fromYearToggle: document.querySelector("#download-from-year-toggle"),
    toMonthToggle: document.querySelector("#download-to-month-toggle"),
    toYearToggle: document.querySelector("#download-to-year-toggle"),
    documentType: document.querySelector("#download-document-type"),
    documentTypeToggle: document.querySelector("#download-document-type-toggle"),
    xml: document.querySelector("#download-xml"),
    pdf: document.querySelector("#download-pdf"),
    start: document.querySelector("#start-download"),
    cancel: document.querySelector("#cancel-download"),
    idle: document.querySelector("#download-idle"),
    progress: document.querySelector("#download-progress"),
    files: document.querySelector("#download-files-count"),
    period: document.querySelector("#download-period"),
    page: document.querySelector("#download-page"),
    message: document.querySelector("#download-message"),
    error: document.querySelector("#download-error")
  };

  let running = false;
  let downloadTabId = null;

  const MONTH_NAMES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre"
  ];
  const DOCUMENT_TYPE_OPTIONS = [
    { value: "1", label: "Factura" },
    { value: "2", label: "Liquidación de compra de bienes y servicios" },
    { value: "3", label: "Nota de crédito" },
    { value: "4", label: "Nota de débito" },
    { value: "6", label: "Comprobante de retención" }
  ];

  const periodPickers = [];

  function closePeriodPickers(except = null) {
    for (const picker of periodPickers) {
      if (picker === except) continue;
      picker.menu.hidden = true;
      picker.toggle.setAttribute("aria-expanded", "false");
    }
  }

  function setPeriodPickerValue(picker, value, label) {
    picker.input.value = String(value);
    picker.toggle.querySelector(".period-choice-value").textContent = label;
    for (const option of picker.menu.querySelectorAll(".period-choice-option")) {
      option.setAttribute("aria-selected", String(option.dataset.value === String(value)));
    }
  }

  function createPeriodPicker(input, toggle, options) {
    const menu = document.getElementById(toggle.getAttribute("aria-controls"));
    const picker = { input, toggle, menu };
    periodPickers.push(picker);

    for (const { value, label } of options) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "period-choice-option";
      option.dataset.value = String(value);
      option.textContent = label;
      option.setAttribute("role", "option");
      option.addEventListener("click", () => {
        setPeriodPickerValue(picker, value, label);
        closePeriodPickers();
      });
      menu.append(option);
    }

    toggle.addEventListener("click", () => {
      const willOpen = menu.hidden;
      closePeriodPickers(picker);
      menu.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", String(willOpen));
    });
    return picker;
  }

  function initializePeriodSelectors() {
    const now = new Date();
    const monthOptions = MONTH_NAMES.map((label, index) => ({
      value: String(index + 1).padStart(2, "0"),
      label
    }));
    const yearOptions = shared.yearRange(now.getFullYear(), 4).map((year) => ({
      value: String(year),
      label: String(year)
    }));

    const fromMonthPicker = createPeriodPicker(elements.fromMonth, elements.fromMonthToggle, monthOptions);
    const toMonthPicker = createPeriodPicker(elements.toMonth, elements.toMonthToggle, monthOptions);
    const fromYearPicker = createPeriodPicker(elements.fromYear, elements.fromYearToggle, yearOptions);
    const toYearPicker = createPeriodPicker(elements.toYear, elements.toYearToggle, yearOptions);
    const documentTypePicker = createPeriodPicker(
      elements.documentType,
      elements.documentTypeToggle,
      DOCUMENT_TYPE_OPTIONS
    );
    const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
    setPeriodPickerValue(fromMonthPicker, currentMonth, MONTH_NAMES[now.getMonth()]);
    setPeriodPickerValue(toMonthPicker, currentMonth, MONTH_NAMES[now.getMonth()]);
    setPeriodPickerValue(fromYearPicker, now.getFullYear(), String(now.getFullYear()));
    setPeriodPickerValue(toYearPicker, now.getFullYear(), String(now.getFullYear()));
    setPeriodPickerValue(documentTypePicker, "1", "Factura");
  }

  function selectedPeriod(monthSelect, yearSelect) {
    return `${yearSelect.value}-${monthSelect.value}`;
  }

  function setError(text = "") {
    elements.error.textContent = text;
    elements.error.hidden = !text;
  }

  function setRunning(value) {
    running = value;
    elements.start.disabled = value;
    elements.start.textContent = value ? "Descarga en curso..." : "Iniciar descarga";
    elements.cancel.hidden = !value;
    elements.fromMonthToggle.disabled = value;
    elements.fromYearToggle.disabled = value;
    elements.toMonthToggle.disabled = value;
    elements.toYearToggle.disabled = value;
    elements.documentTypeToggle.disabled = value;
    if (value) closePeriodPickers();
    elements.xml.disabled = value;
    elements.pdf.disabled = value;
  }

  function showProgress(message) {
    elements.idle.hidden = true;
    elements.progress.hidden = false;
    elements.message.textContent = message;
  }

  async function activeDownloadTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let isSriPage = false;
    try {
      isSriPage = new URL(tab?.url || "").hostname === "srienlinea.sri.gob.ec";
    } catch (_error) {
      isSriPage = false;
    }
    if (!tab?.id || !isSriPage) {
      throw new Error(
        "Antes de iniciar, debe encontrarse en la página de Comprobantes electrónicos recibidos del SRI."
      );
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "SRI_DOWNLOAD_PING" });
    } catch (_error) {
      throw new Error(
        "La página de comprobantes aún no está lista. Espere a que termine de cargar y vuelva a intentarlo."
      );
    }
    if (!response?.ok || !response.ready) {
      throw new Error(
        "No se encontró el formulario de consulta. Confirme que está en Comprobantes electrónicos recibidos y espere a que termine de cargar."
      );
    }
    return tab;
  }

  async function startDownload() {
    if (running) return;
    setError();
    try {
      const from = selectedPeriod(elements.fromMonth, elements.fromYear);
      const to = selectedPeriod(elements.toMonth, elements.toYear);
      shared.monthRange(from, to);
      if (!elements.xml.checked && !elements.pdf.checked) {
        throw new Error("Seleccione XML, PDF o ambos.");
      }

      setRunning(true);
      elements.files.textContent = "0";
      elements.period.textContent = "--";
      elements.page.textContent = "--";
      showProgress("Verificando la página actual del SRI...");

      const tab = await activeDownloadTab();
      downloadTabId = tab.id;

      await chrome.storage.session.set({
        sriDownloadPanelState: { running: true, tabId: downloadTabId }
      });
      const response = await chrome.tabs.sendMessage(downloadTabId, {
        type: "SRI_DOWNLOAD_START",
        from,
        to,
        documentType: elements.documentType.value,
        xml: elements.xml.checked,
        pdf: elements.pdf.checked
      });
      if (!response?.ok) throw new Error(response?.error || "No se pudo iniciar la descarga.");
      // El proceso puede terminar mientras se espera la respuesta de la pestaña.
      if (running) showProgress("Descarga iniciada. No cierre la pestaña del SRI.");
    } catch (error) {
      setRunning(false);
      setError(error.message);
      await chrome.storage.session.remove("sriDownloadPanelState");
    }
  }

  async function cancelDownload() {
    if (!running) return;
    elements.cancel.disabled = true;
    try {
      if (downloadTabId) {
        await chrome.tabs.sendMessage(downloadTabId, { type: "SRI_DOWNLOAD_CANCEL" });
      }
      setRunning(false);
      showProgress("Descarga cancelada.");
      await chrome.storage.session.remove("sriDownloadPanelState");
    } catch (_error) {
      setRunning(false);
      setError("La pestaña de descarga ya no está disponible.");
      await chrome.storage.session.remove("sriDownloadPanelState");
    } finally {
      elements.cancel.disabled = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.tab?.id !== downloadTabId) return;
    if (message?.type === "SRI_DOWNLOAD_PROGRESS") {
      if (message.filesDownloaded !== undefined) elements.files.textContent = message.filesDownloaded;
      if (message.period) elements.period.textContent = message.period;
      if (message.page) elements.page.textContent = message.page;
      showProgress(message.message || "Procesando...");
    }
    if (message?.type === "SRI_DOWNLOAD_FINISHED") {
      setRunning(false);
      chrome.storage.session.remove("sriDownloadPanelState");
      if (message.ok) {
        elements.files.textContent = message.filesDownloaded || 0;
        showProgress(
          `Descarga finalizada: ${message.documentsDownloaded || 0} comprobantes y ${message.filesDownloaded || 0} archivos.`
        );
      } else {
        setError(message.error || "La descarga se detuvo con un error.");
        showProgress("Proceso detenido.");
      }
    }
  });

  async function restoreState() {
    const stored = await chrome.storage.session.get("sriDownloadPanelState");
    const state = stored.sriDownloadPanelState;
    if (!state?.running || !state.tabId) return;
    try {
      const response = await chrome.tabs.sendMessage(state.tabId, { type: "SRI_DOWNLOAD_PING" });
      if (response?.running) {
        downloadTabId = state.tabId;
        setRunning(true);
        showProgress("Descarga en curso en la pestaña del SRI.");
        return;
      }
    } catch (_error) {
      // La ejecucion ya no existe.
    }
    await chrome.storage.session.remove("sriDownloadPanelState");
  }

  initializePeriodSelectors();
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".period-choice")) closePeriodPickers();
  });
  elements.start.addEventListener("click", startDownload);
  elements.cancel.addEventListener("click", cancelDownload);
  restoreState().catch((error) => setError(error.message));
})();
