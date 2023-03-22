import { drawGraph } from "./index.js";

let form = document.querySelector("#upload");
let file = document.querySelector("#file");

/**
 * Log the uploaded file to the console
 * @param {event} Event The file loaded event
 */
function onLoadHandler(event) {
  let str = event.target.result;
  let json = JSON.parse(str);
  drawGraph(json);
}

/**
 * Handle submit events
 * @param  {Event} event The event object
 */
function handleSubmit(event) {
  event.preventDefault();
  if (!file.value.length) return;

  let reader = new FileReader();
  reader.onload = onLoadHandler;
  reader.readAsText(file.files[0]);
}

form.addEventListener("submit", handleSubmit);
