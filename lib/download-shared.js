(function exposeDownloadShared(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SriDownloadShared = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function downloadSharedFactory() {
  "use strict";

  function parseMonth(value) {
    const match = String(value ?? "").match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match) throw new Error("Seleccione un mes válido en formato AAAA-MM.");
    return { year: Number(match[1]), month: Number(match[2]), value: match[0] };
  }

  function monthRange(fromValue, toValue) {
    const from = parseMonth(fromValue);
    const to = parseMonth(toValue);
    if (from.value > to.value) throw new Error("El mes inicial no puede ser posterior al mes final.");

    const periods = [];
    let year = from.year;
    let month = from.month;
    while (year < to.year || (year === to.year && month <= to.month)) {
      periods.push({ year, month, value: `${year}-${String(month).padStart(2, "0")}` });
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return periods;
  }

  function yearRange(currentYear, yearsBack = 4) {
    const year = Number(currentYear);
    const back = Number(yearsBack);
    if (!Number.isInteger(year) || !Number.isInteger(back) || back < 0) {
      throw new Error("No se pudo generar el rango de años.");
    }
    return Array.from({ length: back + 1 }, (_item, index) => year - index);
  }

  function sanitizeDocumentName(value, fallback = "Comprobante") {
    const normalized = String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .replace(/\s+/g, "_");
    const safe = normalized.replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "");
    return safe || fallback;
  }

  function invoiceFromText(value) {
    const match = String(value ?? "").match(/\b(\d{3}-\d{3}-\d{9})\b/);
    return match?.[1] || "";
  }

  function documentBaseName(rowText) {
    const invoice = invoiceFromText(rowText);
    const fallback = invoice ? `Factura_${invoice}` : "Comprobante";
    return sanitizeDocumentName(rowText, fallback);
  }

  return { parseMonth, monthRange, yearRange, sanitizeDocumentName, invoiceFromText, documentBaseName };
});
