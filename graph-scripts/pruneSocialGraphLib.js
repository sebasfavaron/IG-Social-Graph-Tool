export function removeSingleLinks(socialGraph) {
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

export function saveGraph(socialGraph) {
  fs.writeFile(
    fileName.replace('.json', '-pruned.json'),
    JSON.stringify(socialGraph),
    (err) => {
      if (err) throw err;
      console.log('The file has been saved!');
    }
  );
}
