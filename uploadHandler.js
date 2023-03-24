import { drawGraph } from "./index.js";

let file = document.querySelector("#file");
let fileInputContainer = document.querySelector("#file-input-container");
let boorkmarklet = document.querySelector("#boorkmarklet");

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
function handleSubmit() {
  let reader = new FileReader();
  reader.onload = onLoadHandler;
  reader.readAsText(file.files[0]);
  fileInputContainer.remove();
  boorkmarklet.remove();
}

file.addEventListener("change", handleSubmit);
