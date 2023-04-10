const { argv } = require('process');
const fs = require('fs');

function addMissingNodes(socialGraph) {
  socialGraph.links.forEach((link) => {
    if (
      socialGraph.nodes.find((node) => node.id === link.source) === undefined
    ) {
      console.log('[source] adding missing node: ' + link.source);
      socialGraph.nodes.push({ id: link.source, group: 1 });
    }
    if (
      socialGraph.nodes.find((node) => node.id === link.target) === undefined
    ) {
      console.log('[target] adding missing node: ' + link.target);
      socialGraph.nodes.push({ id: link.target, group: 1 });
    }
  });
  return socialGraph;
}

function saveGraph(socialGraph) {
  fs.writeFile(
    fileName.replace('.json', '-with-all-nodes.json'),
    JSON.stringify(socialGraph),
    (err) => {
      if (err) throw err;
      console.log('The file has been saved!');
    }
  );
}

const fileName = argv[2];
if (fileName === undefined) {
  console.log('Please provide a file name');
  return;
}
let socialGraph = require(`${fileName}`);

socialGraph = addMissingNodes(socialGraph);
saveGraph(socialGraph);
