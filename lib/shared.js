(function exposeShared(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.SriShared = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function sharedFactory() {
  "use strict";

  const CATEGORY_DEFINITIONS = Object.freeze([
    { key: "alimentacion", label: "Alimentación", fieldToken: "alimentacion" },
    {
      key: "educacion_arte_cultura",
      label: "Educación, Arte y Cultura",
      fieldToken: "educacionArteCultura"
    },
    { key: "salud", label: "Salud", fieldToken: "salud" },
    { key: "vestimenta", label: "Vestimenta", fieldToken: "vestimenta" },
    { key: "vivienda", label: "Vivienda", fieldToken: "vivienda" },
    { key: "turismo", label: "Turismo", fieldToken: "turismo" }
  ]);

  function normalizeRuc(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits.length === 13 ? digits : "";
  }

  function normalizeInvoice(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits.length === 15 ? digits : "";
  }

  function formatInvoice(value) {
    const digits = normalizeInvoice(value);
    return digits ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : "";
  }

  function amountToCents(value) {
    const original = String(value ?? "").trim();
    if (!original) return 0;

    let text = original.replace(/[\s$]/g, "");
    if (text.startsWith("-") || !/^[0-9.,]+$/.test(text)) {
      throw new Error(`Valor monetario inválido: ${original}`);
    }

    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    let decimalSeparator = "";

    if (comma >= 0 && dot >= 0) {
      decimalSeparator = comma > dot ? "," : ".";
    } else if (comma >= 0) {
      const decimals = text.length - comma - 1;
      decimalSeparator = decimals > 0 && decimals <= 2 ? "," : "";
    } else if (dot >= 0) {
      const decimals = text.length - dot - 1;
      decimalSeparator = decimals > 0 && decimals <= 2 ? "." : "";
    }

    let integerPart;
    let decimalPart;
    if (decimalSeparator) {
      const position = text.lastIndexOf(decimalSeparator);
      integerPart = text.slice(0, position).replace(/[.,]/g, "");
      decimalPart = text.slice(position + 1);
    } else {
      integerPart = text.replace(/[.,]/g, "");
      decimalPart = "";
    }

    if (!integerPart || !/^\d+$/.test(integerPart) || !/^\d{0,2}$/.test(decimalPart)) {
      throw new Error(`Valor monetario inválido: ${original}`);
    }

    const cents = Number(integerPart) * 100 + Number(decimalPart.padEnd(2, "0") || "0");
    if (!Number.isSafeInteger(cents) || cents > 9_999_999) {
      throw new Error(`Valor monetario fuera de rango: ${original}`);
    }
    return cents;
  }

  function centsToInput(cents) {
    if (!Number.isInteger(cents) || cents < 0) {
      throw new Error("El importe en centavos no es válido");
    }
    return (cents / 100).toFixed(2);
  }

  function centsToDisplay(cents) {
    if (!Number.isInteger(cents)) return "--";
    return new Intl.NumberFormat("es-EC", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2
    }).format(cents / 100);
  }

  function projectedTotalCents(currentValues, requestedValues) {
    return CATEGORY_DEFINITIONS.reduce((sum, category) => {
      const desired = requestedValues[category.key];
      const current = currentValues[category.key];
      return sum + (desired > 0 ? desired : Number.isInteger(current) ? current : 0);
    }, 0);
  }

  function specifiedValuesEqual(currentValues, requestedValues) {
    return CATEGORY_DEFINITIONS.every((category) => {
      const desired = requestedValues[category.key];
      return desired === 0 || currentValues[category.key] === desired;
    });
  }

  return {
    CATEGORY_DEFINITIONS,
    normalizeRuc,
    normalizeInvoice,
    formatInvoice,
    amountToCents,
    centsToInput,
    centsToDisplay,
    projectedTotalCents,
    specifiedValuesEqual
  };
});
