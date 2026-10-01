"use strict";

(() => {
  const elements = {
    home: document.querySelector("#home-view"),
    fill: document.querySelector("#fill-view"),
    download: document.querySelector("#download-view"),
    chooseFill: document.querySelector("#choose-fill"),
    chooseDownload: document.querySelector("#choose-download"),
    back: document.querySelector("#back-home"),
    title: document.querySelector("#app-title"),
    subtitle: document.querySelector("#app-subtitle")
  };

  const titles = {
    home: [
      "Asistente de Gastos EC",
      "Tu ayudante en la descarga de comprobantes electrónicos y llenado de anexo de gastos personales"
    ],
    fill: ["Anexo de gastos personales", "Asistente de llenado manual"],
    download: ["Comprobantes electrónicos", "Descarga desde el SRI"]
  };

  function showMode(mode) {
    elements.home.hidden = mode !== "home";
    elements.fill.hidden = mode !== "fill";
    elements.download.hidden = mode !== "download";
    elements.back.hidden = mode === "home";
    [elements.title.textContent, elements.subtitle.textContent] = titles[mode];
    document.body.dataset.mode = mode;
    window.dispatchEvent(new CustomEvent("sri-mode-changed", { detail: { mode } }));
  }

  elements.chooseFill.addEventListener("click", () => showMode("fill"));
  elements.chooseDownload.addEventListener("click", () => showMode("download"));
  elements.back.addEventListener("click", () => showMode("home"));
  showMode("home");
})();
