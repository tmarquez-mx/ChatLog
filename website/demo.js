"use strict";
const cases = {
  ensayo: {
    project: "Ensayo sobre participación ciudadana",
    model: "ChatGPT",
    purpose: "Conceptualización",
    prompt:
      "Propón un esquema para comparar participación ciudadana y representación política.",
    verification:
      "Contrasté las categorías con las lecturas del curso. Reorganicé el esquema y redacté el argumento final con mis propias palabras.",
  },
  clase: {
    project: "Seminario de metodología: discusión de una lectura",
    model: "Gemini",
    purpose: "Planificación de clases",
    prompt:
      "Sugiere cinco preguntas abiertas para discutir el diseño metodológico de una investigación.",
    verification:
      "Revisé la pertinencia de cada pregunta, descarté dos y adapté las restantes a los objetivos de aprendizaje y al nivel del grupo.",
  },
  investigacion: {
    project: "Artículo sobre experiencias de participación",
    model: "Claude",
    purpose: "Revisión de escritura",
    prompt:
      "Sugiere mejoras de organización para este borrador de discusión, sin añadir datos ni referencias.",
    verification:
      "Comparé las sugerencias con los resultados originales. Verifiqué que no cambiaran su sentido y asumí la revisión y redacción finales.",
  },
};
const fields = ["project", "model", "purpose", "prompt", "verification"];
const $ = (id) => document.getElementById(id);
let currentCase = "ensayo";
let output = "";
function generate() {
  const data = Object.fromEntries(fields.map((id) => [id, $(id).value.trim()]));
  const missing = fields.find((id) => !data[id]);
  if (missing) {
    $("demo-status").textContent =
      "Completa todos los campos para documentar el ejemplo.";
    $(missing).focus();
    return;
  }
  $("output-project").textContent = data.project;
  output = `DECLARACIÓN DE USO DE INTELIGENCIA ARTIFICIAL\nProyecto: ${data.project}\n\nPara este trabajo utilicé ${data.model} con la finalidad de ${data.purpose.toLocaleLowerCase("es")}.\n\nLa instrucción utilizada fue: «${data.prompt}».\n\nVerificación humana y decisiones: ${data.verification}\n\nAsumo la responsabilidad de la revisión y del contenido final del trabajo.`;
  $("declaration").textContent = output.split("\n\n").slice(1).join("\n\n");
  $("demo-status").textContent =
    "Declaración actualizada con los datos del registro.";
  $("copy-status").textContent = "";
  $("copy").disabled = false;
  $("download").disabled = false;
}
function selectCase(key) {
  currentCase = key;
  fields.forEach((id) => {
    $(id).value = cases[key][id];
  });
  document
    .querySelectorAll("[data-case]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.case === key)),
    );
  generate();
}
document
  .querySelectorAll("[data-case]")
  .forEach((button) =>
    button.addEventListener("click", () => selectCase(button.dataset.case)),
  );
fields.forEach((id) =>
  $(id).addEventListener("input", () => {
    $("demo-status").textContent =
      "Tienes cambios: genera de nuevo la declaración para incluirlos.";
    $("copy").disabled = true;
    $("download").disabled = true;
  }),
);
$("generate").addEventListener("click", generate);
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output);
    $("copy-status").textContent = "Texto copiado.";
  } catch {
    $("copy-status").textContent =
      "No se pudo copiar. Puedes descargar el archivo .txt o seleccionar el texto.";
  }
});
$("download").addEventListener("click", () => {
  const blob = new Blob(
    [output + "\n\nEjemplo ilustrativo de la demo web de ChatLog."],
    { type: "text/plain;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ChatLog-declaracion-ejemplo-${currentCase}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("copy-status").textContent = "Descarga del ejemplo iniciada.";
});
const shots = {
  proyectos: [
    "Proyectos",
    "Crea un proyecto y documenta cada interacción con IA.",
  ],
  declaracion: [
    "Declaración de uso",
    "Selecciona registros y configura tu declaración en la extensión.",
  ],
  herramientas: [
    "Herramientas",
    "Exporta por proyecto y conserva respaldos de tu trabajo.",
  ],
  estadisticas: [
    "Estadísticas",
    "Observa la distribución de tus interacciones, modelos y proyectos.",
  ],
};
document.querySelectorAll("[data-shot]").forEach((button) =>
  button.addEventListener("click", () => {
    const key = button.dataset.shot;
    $("screenshot").src = `assets/${key}.png`;
    $("screenshot").alt =
      `ChatLog V2: sección ${shots[key][0]} con datos de ejemplo`;
    $("shot-caption").textContent = shots[key][1];
    document
      .querySelectorAll("[data-shot]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
  }),
);
selectCase("ensayo");
