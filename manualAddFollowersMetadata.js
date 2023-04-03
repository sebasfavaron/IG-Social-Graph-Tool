const { argv } = require('process');
const fs = require('fs');

function addMetadata(socialGraph, loggedUsername) {
  const metadata = {
    loggedUsername: loggedUsername,
    loggedUserFetched: true,
    lastRun: '2000-01-01T00:00:00.001Z',
    followersFetched: {},
  };
  socialGraph.nodes.forEach((node) => {
    metadata.followersFetched[node.id] = false;
  });
  socialGraph.links.forEach((link) => {
    metadata.followersFetched[link.target] = true;
  });
  socialGraph.metadata = metadata;
  return socialGraph;
}

function saveGraph(socialGraph) {
  fs.writeFile(
    fileName.replace('.json', '-with-metadata.json'),
    JSON.stringify(socialGraph),
    (err) => {
      if (err) throw err;
      console.log('The file has been saved!');
    }
  );
}

const fileName = argv[2];
const loggedUsername = argv[3];
if (fileName === undefined) {
  console.log('Please provide a file name and then a username');
  return;
}
let socialGraph = require(`${fileName}`);

socialGraph = addMetadata(socialGraph, loggedUsername);
saveGraph(socialGraph);
