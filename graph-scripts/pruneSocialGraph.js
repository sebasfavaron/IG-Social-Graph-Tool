const { argv } = require('process');
const fs = require('fs');

function removeSingleLinks(socialGraph) {
  const newNodes = socialGraph.nodes.filter(
    (node) =>
      socialGraph.links.filter(
        (link) => node.id === link.source || node.id === link.target
      ).length > 1
  );
  const removedNodes = socialGraph.nodes.filter(
    (node) => newNodes.find((n) => n.id === node.id) === undefined
  );
  console.log(`Removed nodes: ${removedNodes.map((n) => n.id).join(', ')}`);
  const newNodeIds = newNodes.map((n) => n.id);
  const newLinks = socialGraph.links.filter(
    (link) =>
      newNodeIds.includes(link.source) && newNodeIds.includes(link.target)
  );
  return {
    nodes: newNodes,
    links: newLinks,
  };
}

function saveGraph(socialGraph) {
  fs.writeFile(
    fileName.replace('.json', '-pruned.json'),
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

// Done twice due to a bug where first pass removes a lone node that generates a new lone node
socialGraph = removeSingleLinks(socialGraph);
socialGraph = removeSingleLinks(socialGraph);

saveGraph(socialGraph);