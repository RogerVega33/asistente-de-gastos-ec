"use strict";

(() => {
  const shared = globalThis.SriShared;
  const DETAIL_FORM_SELECTOR = "form#deduccion";
  const CARD_SELECTOR = "#acordeon .panel.panel-default";
  const FIELD_DELAY_MS = 200;
  const FILLED_FIELD_CLASS = "sri-assistant-field-filled";
  const FILLED_CARD_CLASS = "sri-assistant-card-filled";
  // Solo importes e identificadores de la página visible, nunca nodos antiguos.
  const filledFields = new Map();
  let filledSignature = "";
  let highlightObserver = null;
  let highlightTimer = null;
  let pageGeneration = 0;

  function clearHighlights(invalidateFill = true) {
    if (invalidateFill) pageGeneration += 1;
    highlightObserver?.disconnect();
    highlightObserver = null;
    clearTimeout(highlightTimer);
    highlightTimer = null;
    filledFields.clear();
    filledSignature = "";
    document.removeEventListener("input", onFieldEdited, true);
    document.removeEventListener("change", onFieldEdited, true);
    document.querySelectorAll(`.${FILLED_FIELD_CLASS}, .${FILLED_CARD_CLASS}`)
      .forEach((node) => node.classList.remove(FILLED_FIELD_CLASS, FILLED_CARD_CLASS));
  }

  function matchesAmount(input, cents) {
    try {
      return !!input && shared.amountToCents(input.value) === cents;
    } catch (_error) {
      return false;
    }
  }

  function cardInvoice(card) {
    const match = card.textContent.match(/FACTURA\s+(\d{3}-?\d{3}-?\d{9})/i);
    return shared.normalizeInvoice(match?.[1]);
  }

  function restoreHighlights() {
    highlightTimer = null;
    if (!filledFields.size) return;
    if (pageSignature() !== filledSignature) {
      clearHighlights();
      return;
    }
    // Una sola pasada por las tarjetas; como máximo seis campos por factura.
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      const fields = filledFields.get(cardInvoice(card));
      if (!fields) continue;
      let marked = false;
      for (const [key, cents] of fields) {
        const category = shared.CATEGORY_DEFINITIONS.find((item) => item.key === key);
        const input = findCategoryInput(card, category);
        const matches = matchesAmount(input, cents);
        if (input && input.classList.contains(FILLED_FIELD_CLASS) !== matches) {
          input.classList.toggle(FILLED_FIELD_CLASS, matches);
        }
        marked ||= matches;
      }
      if (card.classList.contains(FILLED_CARD_CLASS) !== marked) {
        card.classList.toggle(FILLED_CARD_CLASS, marked);
      }
    }
  }

  function onFieldEdited(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const card = input.closest(CARD_SELECTOR);
    if (!card) return;
    const invoice = cardInvoice(card);
    const fields = filledFields.get(invoice);
    if (!fields) return;
    const category = shared.CATEGORY_DEFINITIONS.find(
      (item) => input.id.endsWith(`:${item.fieldToken}:campo`)
    );
    if (!category || !fields.has(category.key) || matchesAmount(input, fields.get(category.key))) return;
    fields.delete(category.key);
    input.classList.remove(FILLED_FIELD_CLASS);
    if (!fields.size) filledFields.delete(invoice);
    if (!card.querySelector(`.${FILLED_FIELD_CLASS}`)) card.classList.remove(FILLED_CARD_CLASS);
    if (!filledFields.size) clearHighlights(false);
  }

  function rememberFilledField(invoice, category, cents, signature) {
    if (!filledFields.size) {
      filledSignature = signature;
      const form = document.querySelector(DETAIL_FORM_SELECTOR);
      // El padre permite detectar también el reemplazo AJAX del formulario.
      // No observamos atributos: nuestras clases CSS no generan notificaciones.
      highlightObserver = new MutationObserver((mutations) => {
        const relevant = mutations.some((mutation) => {
          const target = mutation.target;
          return target.nodeType === Node.ELEMENT_NODE && (
            target.closest(`${DETAIL_FORM_SELECTOR}, form#proveedor-info`) ||
            [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
              node.nodeType === Node.ELEMENT_NODE && (
                node.matches(`${DETAIL_FORM_SELECTOR}, form#proveedor-info`) ||
                node.querySelector(`${DETAIL_FORM_SELECTOR}, form#proveedor-info`)
              )
            )
          );
        });
        // Agrupa ráfagas AJAX; no hay sondeo ni temporizador permanente.
        if (relevant && highlightTimer === null) {
          highlightTimer = setTimeout(restoreHighlights, 50);
        }
      });
      highlightObserver.observe(form.parentElement, { childList: true, subtree: true });
      document.addEventListener("input", onFieldEdited, true);
      document.addEventListener("change", onFieldEdited, true);
    }
    if (!filledFields.has(invoice)) filledFields.set(invoice, new Map());
    filledFields.get(invoice).set(category.key, cents);
    const card = findCardByInvoice(invoice);
    const input = card && findCategoryInput(card, category);
    if (matchesAmount(input, cents)) {
      input.classList.add(FILLED_FIELD_CLASS);
      card.classList.add(FILLED_CARD_CLASS);
    }
  }

  function assertSamePage(signature, generation) {
    if (generation !== pageGeneration || pageSignature() !== signature) {
      clearHighlights();
      throw new Error("La página cambió durante el llenado. Revise los valores antes de continuar.");
    }
  }

  function getProviderRuc() {
    // La navegación por POST puede conservar una URL del proveedor anterior.
    const providerTable = document.querySelector("form#proveedor-info table");
    const match = providerTable?.textContent.match(/\b\d{13}\b/);
    return shared.normalizeRuc(match?.[0]) ||
      shared.normalizeRuc(new URL(location.href).searchParams.get("emisor"));
  }

  function getPageNumber() {
    const pagination = document.querySelector(`${DETAIL_FORM_SELECTOR} .pagination`);
    // El SRI omite los controles cuando las facturas caben en una sola página.
    if (!pagination) return "1";
    return pagination.querySelector("li.active")?.textContent.trim() || "?";
  }

  function parseMoneyFromText(text) {
    const match = String(text ?? "").match(/\$\s*([0-9.,]+)/);
    if (!match) return null;
    try {
      return shared.amountToCents(match[1]);
    } catch (_error) {
      return null;
    }
  }

  function findCategoryInput(card, category) {
    return card.querySelector(`input[id$=":${category.fieldToken}:campo"]`);
  }

  function readCard(card) {
    const invoiceMatch = card.textContent.match(/FACTURA\s+(\d{3}-?\d{3}-?\d{9})/i);
    const invoice = shared.normalizeInvoice(invoiceMatch?.[1]);
    if (!invoice) return null;

    const values = {};
    const missingFields = [];
    for (const category of shared.CATEGORY_DEFINITIONS) {
      const input = findCategoryInput(card, category);
      if (!input) {
        missingFields.push(category.key);
        continue;
      }
      try {
        values[category.key] = shared.amountToCents(input.value);
      } catch (_error) {
        values[category.key] = null;
      }
    }

    const currentTotalCents = Object.values(values).reduce(
      (sum, value) => sum + (Number.isInteger(value) ? value : 0),
      0
    );
    const remainingNode = card.querySelector('[id$=":panel:deducible"]');
    const remainingCents = parseMoneyFromText(remainingNode?.textContent);

    return {
      invoice,
      displayInvoice: shared.formatInvoice(invoice),
      values,
      currentTotalCents,
      remainingCents,
      availableTotalCents:
        remainingCents === null ? null : currentTotalCents + remainingCents,
      missingFields
    };
  }

  function readPage() {
    const form = document.querySelector(DETAIL_FORM_SELECTOR);
    if (!form) {
      return {
        ok: false,
        error: "Abra el detalle de facturas de un proveedor en el SRI."
      };
    }

    const ruc = getProviderRuc();
    if (!ruc) {
      return { ok: false, error: "No se pudo identificar el RUC del proveedor actual." };
    }

    const invoices = Array.from(document.querySelectorAll(CARD_SELECTOR))
      .map(readCard)
      .filter(Boolean);
    if (!invoices.length) {
      return { ok: false, error: "No se encontraron facturas en la página actual." };
    }

    const duplicates = invoices
      .map((invoice) => invoice.invoice)
      .filter((invoice, index, all) => all.indexOf(invoice) !== index);
    if (duplicates.length) {
      return { ok: false, error: "La página contiene números de factura duplicados." };
    }

    return {
      ok: true,
      ruc,
      pageNumber: getPageNumber(),
      invoices
    };
  }

  function findCardByInvoice(invoice) {
    return Array.from(document.querySelectorAll(CARD_SELECTOR)).find((card) => {
      const match = card.textContent.match(/FACTURA\s+(\d{3}-?\d{3}-?\d{9})/i);
      return shared.normalizeInvoice(match?.[1]) === invoice;
    });
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("No se pudo acceder al campo del formulario.");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function validateRequestedRow(page, requested) {
    if (requested.ruc !== page.ruc) {
      return "El RUC de la fila no corresponde al proveedor abierto.";
    }
    const invoice = page.invoices.find((item) => item.invoice === requested.invoice);
    if (!invoice) return "La factura ya no se encuentra en la página visible.";
    if (invoice.missingFields.length) return "La factura no contiene todos los campos esperados.";

    const projectedTotal = shared.projectedTotalCents(invoice.values, requested.values);
    if (
      invoice.availableTotalCents !== null &&
      projectedTotal > invoice.availableTotalCents
    ) {
      return "La suma solicitada supera el máximo disponible mostrado por el SRI.";
    }
    return "";
  }

  async function fillInvoice(requested, signature, generation) {
    let changedFields = 0;
    for (const category of shared.CATEGORY_DEFINITIONS) {
      const desiredCents = requested.values[category.key];
      // En el CSV, cero significa "no modificar". Esto evita llamadas AJAX
      // innecesarias y nunca borra un valor existente en el formulario.
      if (desiredCents === 0) continue;

      assertSamePage(signature, generation);

      let card = findCardByInvoice(requested.invoice);
      let input = card && findCategoryInput(card, category);
      if (!input) throw new Error(`No se encontró el campo ${category.label}.`);

      const currentCents = shared.amountToCents(input.value);
      if (currentCents === desiredCents) continue;

      setInputValue(input, shared.centsToInput(desiredCents));
      // Escalona las solicitudes sin esperar a que finalice cada respuesta AJAX.
      await sleep(FIELD_DELAY_MS);

      assertSamePage(signature, generation);

      card = findCardByInvoice(requested.invoice);
      input = card && findCategoryInput(card, category);
      if (!input || shared.amountToCents(input.value) !== desiredCents) {
        throw new Error(`El SRI no conservó el valor escrito en ${category.label}.`);
      }
      changedFields += 1;
      rememberFilledField(requested.invoice, category, desiredCents, signature);
    }

    return changedFields;
  }

  async function fillPage(requestedRows) {
    const initialPage = readPage();
    if (!initialPage.ok) return initialPage;
    const signature = pageSignature();
    if (filledFields.size && signature !== filledSignature) clearHighlights();
    const generation = pageGeneration;

    const duplicateRequests = requestedRows
      .map((row) => row.invoice)
      .filter((invoice, index, all) => all.indexOf(invoice) !== index);
    if (duplicateRequests.length) {
      return { ok: false, error: "La solicitud contiene facturas duplicadas." };
    }

    for (const requested of requestedRows) {
      const error = validateRequestedRow(initialPage, requested);
      if (error) {
        return {
          ok: false,
          error: `${shared.formatInvoice(requested.invoice)}: ${error}`
        };
      }
    }

    const results = [];
    for (const requested of requestedRows) {
      try {
        const changedFields = await fillInvoice(requested, signature, generation);
        results.push({ invoice: requested.invoice, ok: true, changedFields });
      } catch (error) {
        results.push({ invoice: requested.invoice, ok: false, error: error.message });
        return {
          ok: false,
          partial: true,
          error: `Se detuvo en ${shared.formatInvoice(requested.invoice)}: ${error.message}`,
          results
        };
      }
    }

    return { ok: true, results, page: readPage() };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SRI_READ_PAGE") {
      if (filledFields.size && pageSignature() !== filledSignature) clearHighlights();
      sendResponse(readPage());
      return false;
    }
    if (message?.type === "SRI_FILL_PAGE") {
      fillPage(Array.isArray(message.rows) ? message.rows : [])
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    return false;
  });

  let lastSignature = "";
  function pageSignature() {
    if (!document.querySelector(DETAIL_FORM_SELECTOR)) return "";
    const ruc = getProviderRuc();
    const invoices = Array.from(document.querySelectorAll(CARD_SELECTOR))
      .map((card) => {
        const match = card.textContent.match(/FACTURA\s+(\d{3}-?\d{3}-?\d{9})/i);
        return shared.normalizeInvoice(match?.[1]);
      })
      .filter(Boolean);
    return ruc && invoices.length
      ? `${ruc}|${getPageNumber()}|${invoices.join(",")}`
      : "";
  }

  let paginationTimer = null;
  let paginationChecksRemaining = 0;
  let saveObserver = null;
  let saveRefreshTimer = null;
  let saveWatchdog = null;
  function notifyVisiblePage() {
    chrome.runtime.sendMessage({ type: "SRI_VISIBLE_PAGE_CHANGED" }).catch(() => {});
  }

  function stopSaveWatch() {
    clearTimeout(saveRefreshTimer);
    clearTimeout(saveWatchdog);
    saveRefreshTimer = null;
    saveWatchdog = null;
    saveObserver?.disconnect();
    saveObserver = null;
  }

  function watchSaveResult(form) {
    stopSaveWatch();
    let responseObserved = false;
    const scheduleRefresh = () => {
      clearTimeout(saveRefreshTimer);
      saveRefreshTimer = setTimeout(() => {
        saveRefreshTimer = null;
        notifyVisiblePage();
        if (responseObserved) stopSaveWatch();
      }, 300);
    };
    // Relee los valores tras Guardar y espera una posible respuesta AJAX tardía.
    scheduleRefresh();
    if (!form?.parentElement) return;
    saveObserver = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        const target = mutation.target.nodeType === Node.TEXT_NODE
          ? mutation.target.parentElement
          : mutation.target;
        return target?.nodeType === Node.ELEMENT_NODE && (
          target.closest(DETAIL_FORM_SELECTOR) ||
          [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
            node.nodeType === Node.ELEMENT_NODE && (
              node.matches(DETAIL_FORM_SELECTOR) || node.querySelector(DETAIL_FORM_SELECTOR)
            )
          )
        );
      });
      if (relevant) {
        responseObserved = true;
        scheduleRefresh();
      }
    });
    // Solo durante el guardado, sin atributos ni cambios de nuestras clases CSS.
    saveObserver.observe(form.parentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
    saveWatchdog = setTimeout(stopSaveWatch, 10000);
  }

  document.addEventListener("click", (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const control = event.target.closest("button, input[type='submit'], input[type='button'], a");
    const form = control?.closest(DETAIL_FORM_SELECTOR);
    if (!form) return;
    const label = [control.textContent, control.value,
      control.getAttribute("aria-label"), control.getAttribute("title")].join(" ");
    if (/\bguardar\b/i.test(label)) watchSaveResult(form);
  }, { capture: true, passive: true });
  document.addEventListener("submit", (event) => {
    if (event.isTrusted && event.target instanceof Element && event.target.matches(DETAIL_FORM_SELECTOR)) {
      watchSaveResult(event.target);
    }
  }, { capture: true, passive: true });

  function checkPageAfterPagination() {
    const signature = pageSignature();
    if (signature && lastSignature && signature !== lastSignature) {
      clearHighlights();
      lastSignature = signature;
      notifyVisiblePage();
      return;
    }

    paginationChecksRemaining -= 1;
    if (paginationChecksRemaining > 0) {
      paginationTimer = setTimeout(checkPageAfterPagination, 500);
    }
  }

  function watchPaginationResult() {
    clearTimeout(paginationTimer);
    paginationChecksRemaining = 20;
    paginationTimer = setTimeout(checkPageAfterPagination, 300);
  }

  lastSignature = pageSignature();
  // Anterior/Siguiente de proveedor carga un documento nuevo, sin pasar por
  // la paginación AJAX de facturas. El receptor ya está registrado al avisar.
  notifyVisiblePage();
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`${DETAIL_FORM_SELECTOR} .pagination a`)) {
        clearHighlights();
        watchPaginationResult();
      }
    },
    { capture: true, passive: true }
  );
  window.addEventListener("pagehide", () => {
    clearHighlights();
    clearTimeout(paginationTimer);
    stopSaveWatch();
  });
  window.addEventListener("popstate", clearHighlights);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      lastSignature = pageSignature();
      notifyVisiblePage();
    }
  });
})();
