const fileName = 'ig-social-data-72.json';
const socialGraph = require(`./${fileName}`);
const fs = require('fs');

function convertSocialGraphToCsv() {
  // const socialGraphRes = await fetch('./ig-social-data-41.json');
  // const socialGraph = await socialGraphRes.json();
  let socialGraphCsv = 'source,target\n';
  for (link of socialGraph.links) {
    socialGraphCsv += `${link.source},${link.target}\n`;
  }
  fs.writeFile('socialGraph.csv', socialGraphCsv, (err) => {
    if (err) throw err;
    console.log('The file has been saved!');
  });
}

function removeSingleLinks() {
  const singles = [];
  for (link of socialGraph.links) {
    let singlesSource = singles.findIndex((single) => single === link.source);
    let singlesTarget = singles.findIndex((single) => single === link.target);
    if (singlesSource === -1 && singlesTarget === -1) {
      singles.push(link.source);
      singles.push(link.target);
    } else {
      if (singlesSource > -1) {
        singles.splice(singlesSource, 1);
      }
      if (singlesTarget > -1) {
        singles.splice(singlesTarget, 1);
      }
    }
  }
  const newSocialGraph = {
    nodes: [],
    links: [],
  };
  console.log(singles);
  for (link of socialGraph.links) {
    if (!singles.includes(link.source) && !singles.includes(link.target)) {
      newSocialGraph.links.push(link);
    }
  }
  newSocialGraph.nodes = [...socialGraph.nodes];

  fs.writeFile(
    fileName.replace('.json', '-pruned.json'),
    JSON.stringify(newSocialGraph),
    (err) => {
      if (err) throw err;
      console.log('The file has been saved!');
    }
  );
}

// convertSocialGraphToCsv();
removeSingleLinks();
