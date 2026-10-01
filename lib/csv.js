(function exposeCsv(root, factory) {
  let shared;
  if (typeof module === "object" && module.exports) {
    shared = require("./shared.js");
    module.exports = factory(shared);
  } else {
    root.SriCsv = factory(root.SriShared);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function csvFactory(shared) {
  "use strict";

  const REQUIRED_HEADERS = Object.freeze([
    "ruc_proveedor",
    "numero_factura",
    "alimentacion",
    "educacion",
    "salud",
    "vestimenta",
    "vivienda",
    "turismo"
  ]);
  const COLUMN_FIELDS = Object.freeze([
    "ruc",
    "invoice",
    "alimentacion",
    "educacion_arte_cultura",
    "salud",
    "vestimenta",
    "vivienda",
    "turismo"
  ]);

  function countDelimiter(line, delimiter) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && character === delimiter) {
        count += 1;
      }
    }
    return count;
  }

  function detectDelimiter(text) {
    const firstLine = String(text).replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "";
    return [",", ";", "\t"]
      .map((delimiter) => ({ delimiter, count: countDelimiter(firstLine, delimiter) }))
      .sort((left, right) => right.count - left.count)[0].delimiter;
  }

  function parseMatrix(text, delimiter = detectDelimiter(text)) {
    const source = String(text ?? "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === '"') {
        if (quoted && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === delimiter && !quoted) {
        row.push(field);
        field = "";
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        row.push(field);
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += character;
      }
    }

    if (quoted) throw new Error("El CSV contiene una comilla sin cerrar");
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    return { rows, delimiter };
  }

  function resolveColumns(headers) {
    const received = headers.map((header) => String(header).trim());
    const valid =
      received.length === REQUIRED_HEADERS.length &&
      REQUIRED_HEADERS.every((header, index) => received[index] === header);
    if (!valid) {
      throw new Error(`El encabezado debe ser exactamente: ${REQUIRED_HEADERS.join(",")}`);
    }
    return Object.fromEntries(COLUMN_FIELDS.map((field, index) => [field, index]));
  }

  function parseCsv(text) {
    const { rows: matrix, delimiter } = parseMatrix(text);
    if (matrix.length < 2) {
      throw new Error("El CSV debe contener una cabecera y al menos una fila de datos");
    }

    const columns = resolveColumns(matrix[0]);
    const data = [];
    const errors = [];
    const seen = new Map();

    matrix.slice(1).forEach((cells, offset) => {
      const line = offset + 2;
      const ruc = shared.normalizeRuc(cells[columns.ruc]);
      const invoice = shared.normalizeInvoice(cells[columns.invoice]);
      if (!ruc) errors.push(`Línea ${line}: RUC inválido`);
      if (!invoice) errors.push(`Línea ${line}: número de factura inválido`);

      const values = {};
      let rowHasAmountError = false;
      for (const category of shared.CATEGORY_DEFINITIONS) {
        try {
          values[category.key] = shared.amountToCents(cells[columns[category.key]]);
        } catch (error) {
          errors.push(`Linea ${line}, ${category.label}: ${error.message}`);
          rowHasAmountError = true;
        }
      }

      if (!ruc || !invoice || rowHasAmountError) return;
      const totalCents = Object.values(values).reduce((sum, value) => sum + value, 0);

      const key = `${ruc}:${invoice}`;
      if (seen.has(key)) {
        errors.push(`Lineas ${seen.get(key)} y ${line}: factura duplicada para el mismo RUC`);
        return;
      }
      seen.set(key, line);
      data.push({ line, ruc, invoice, values, totalCents });
    });

    return {
      rows: data,
      errors,
      delimiter: delimiter === "\t" ? "tabulador" : delimiter
    };
  }

  return { detectDelimiter, parseMatrix, parseCsv, resolveColumns };
});
