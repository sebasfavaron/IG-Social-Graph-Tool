const { argv } = require('process');
const { removeSingleLinks, saveGraph } = require('./pruneSocialGraphLib');

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
