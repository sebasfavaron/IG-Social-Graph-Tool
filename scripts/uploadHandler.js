import { removeSingleLinks } from './graph-scripts/pruneSocialGraphLib';
import { drawGraph } from './graphVisualizer';

/**
 * Log the uploaded file to the console
 * @param {event} Event The file loaded event
 */
function onLoadHandler(event) {
  let str = event.target.result;
  let json = JSON.parse(str);
  onLoadJson(json);
}

/**
 * Handle submit events
 * @param  {Event} event The event object
 */
export function handleSubmit() {
  let reader = new FileReader();
  reader.onload = onLoadHandler;
  reader.readAsText(file.files[0]);
}

export function onLoadJson(jsonGraph) {
  if (jsonGraph.username) {
    document.title = `${jsonGraph.username}'s friends`;
  }

  // Done twice due to a bug where first pass removes a lone node that generates a new lone node
  jsonGraph = removeSingleLinks(jsonGraph);
  jsonGraph = removeSingleLinks(jsonGraph);
  drawGraph(jsonGraph);
}

export async function manualJsonLoad() {
  let jsonGraph = await fetch('/ig-social-data-sebas.json')
    .then((response) => response.json())
    .catch((error) => console.error('Error fetching data:', error));

  onLoadJson(jsonGraph);
}
