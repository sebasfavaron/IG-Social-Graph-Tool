const { argv } = require('process');
const fs = require('fs');

function deduped(array, key) {
  return array.reduce((acc, current) => {
    const x = acc.find((item) => item[key] === current[key]);
    if (!x) {
      acc.push(current);
    }
    return acc;
  }, []);
}

function mergeGraphs(socialGraph1, socialGraph2) {
  const mergedNodes = deduped(
    [...socialGraph1.nodes, ...socialGraph2.nodes],
    'id'
  );
  const mergedLinks = [...socialGraph1.links, ...socialGraph2.links];
  const mergedSocialGraph = {
    nodes: mergedNodes,
    links: mergedLinks,
  };
  return mergedSocialGraph;
}

function saveGraph(socialGraph) {
  fs.writeFile(
    fileName1.replace('.json', '-merged.json'),
    JSON.stringify(socialGraph),
    (err) => {
      if (err) throw err;
      console.log('The file has been saved!');
    }
  );
}

const fileName1 = argv[2];
const fileName2 = argv[3];
if (fileName1 === undefined || fileName2 === undefined) {
  console.log('Please provide two file names');
  return;
}
const socialGraph1 = require(`${fileName1}`);
const socialGraph2 = require(`${fileName2}`);

socialGraph = mergeGraphs(socialGraph1, socialGraph2);
saveGraph(socialGraph);
