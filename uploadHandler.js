import { removeSingleLinks } from './graph-scripts/pruneSocialGraphLib.js';
import { drawGraph } from './index.js';

let file = document.querySelector('#file');
let fileInputContainer = document.querySelector('#file-input-container');
let bookmarklet = document.querySelector('#bookmarklet');

/**
 * Log the uploaded file to the console
 * @param {event} Event The file loaded event
 */
function onLoadHandler(event) {
  let str = event.target.result;
  let json = JSON.parse(str);
  if (json.username) {
    document.title = `${json.username}'s friends`;
  }

  // Done twice due to a bug where first pass removes a lone node that generates a new lone node
  json = removeSingleLinks(json);
  json = removeSingleLinks(json);
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
  const svg = document.getElementsByTagName('svg')[0];
  svg.style.width = '100%';
  svg.style.height = '100%';
  fileInputContainer.remove();
  bookmarklet.remove();
}

file.addEventListener('change', handleSubmit);
