export function drawGraph({ nodes, links }) {
  function convertToValidIdFormat(id) {
    return id.replace(/[^a-zA-Z0-9]/g, '');
  }

  // Define style values
  const nodeCircleSize = 2;
  const textSize = 12;
  const linksStrokeWidth = 1;
  const circlesStrokeWidth = 0.5;
  const textsDx = 10;
  const textsDy = 0.35;
  const selectedNodeColor = '#fc7a2f';

  // Set up the SVG element and add the nodes and links
  const svg = d3.select('svg'),
    width = window.innerWidth,
    height = window.innerHeight;

  const container = svg.append('g').attr('class', 'container');

  const link = container
    .selectAll('.link')
    .data(links)
    .enter()
    .append('line')
    .attr('class', 'link');

  const node = container
    .selectAll('.node')
    .data(nodes)
    .enter()
    .append('g')
    .attr('class', 'node')
    .attr('id', (d) => convertToValidIdFormat(d.id))
    .call(
      d3
        .drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended)
    );

  const circles = node
    .append('circle')
    .attr('r', nodeCircleSize)
    .attr('fill', 'black')
    .attr('stroke', 'white')
    .attr('stroke-width', circlesStrokeWidth);

  const texts = node
    .append('text')
    .text((d) => d.id)
    .attr('dx', textsDx)
    .attr('dy', `${textsDy}em`)
    .attr('font-size', `${textSize}px`)
    .attr('font-family', 'Arial');

  const stylesClass = () => {
    let k = 1;
    let clickedNode = clickedNodeClass();
    return {
      setK: (newK) => {
        k = newK;
        clickedNode.setK(newK);
      },
      clickedNode,
      resetStyles: () => {
        node.style('opacity', 1);
        node.select('text').attr('font-size', textSize / k);
        node.select('circle').attr('fill', 'black');
        node.select('circle').attr('r', nodeCircleSize / k);
      },
      setBackgroundNodesStyles: () => {
        node.style('opacity', 0.1);
        node.select('text').attr('font-size', textSize / k);
        node.select('circle').attr('fill', 'black');
        node.select('circle').attr('r', nodeCircleSize / k);
      },
      setStyles: () => {
        if (k > 1) {
          texts.attr('font-size', textSize / k);
        } else {
          texts.attr('font-size', 0);
        }
        texts.attr('dx', textsDx / k).attr('dy', `${textsDy / k}em`);
        circles
          .attr('r', nodeCircleSize / k)
          .attr('stroke-width', circlesStrokeWidth / k);
        link.style('stroke-width', linksStrokeWidth / k);
      },
    };
  };
  const clickedNodeClass = () => {
    let node = null;
    let k = 1;
    return {
      setK: (newK) => {
        k = newK;
      },
      setNode: (newNode) => {
        node = newNode;
      },
      setStyles: () => {
        console.log({ node });
        if (!node) {
          return;
        }

        node.style('opacity', 1);
        node.select('text').attr('font-size', (textSize * 2) / k);
        node
          .select('circle')
          .attr('fill', selectedNodeColor)
          .attr('r', (nodeCircleSize * 2) / k);
      },
    };
  };
  const styleManager = stylesClass();

  // Add zoom behavior to the SVG element
  const zoom = d3
    .zoom()
    .scaleExtent([0.01, 40])
    .on('zoom', () => {
      const { x, y, k } = d3.event.transform;
      container.attr('transform', `translate(${x}, ${y}) scale(${k})`);

      styleManager.setK(k);
      styleManager.setStyles();
      styleManager.clickedNode.setStyles();
    });
  svg.call(zoom);

  function getUsersFollowers(username) {
    return links.filter((link) => link.target.id === username);
  }

  // Add click listeners
  node.on('click', function (event) {
    d3.event.stopPropagation();

    // Reset all nodes' styles
    styleManager.setBackgroundNodesStyles();

    // Highlight the clicked node
    styleManager.clickedNode.setNode(d3.select(this));
    styleManager.clickedNode.setStyles();

    // Highlight the clicked node's followers
    const usersFollowers = getUsersFollowers(event.id);
    usersFollowers.forEach((follower) =>
      d3
        .select(`#${convertToValidIdFormat(follower.source.id)}`)
        .style('opacity', 1)
    );
  });
  d3.select('body').on('click', () => {
    styleManager.resetStyles();
  });

  // Set up the force simulation
  const simulation = d3
    .forceSimulation(nodes)
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force(
      'link',
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance(0)
        .strength(0.1)
    )
    .force('charge', d3.forceManyBody().strength(-100))
    .force('collision', d3.forceCollide(10));

  // Update the node and link positions on each tick
  simulation.on('tick', () => {
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);
  });

  // Define drag behaviors for the nodes
  function dragstarted(d) {
    if (!d3.event.active) simulation.alphaTarget(0.01).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(d) {
    d.fx = d3.event.x;
    d.fy = d3.event.y;
  }

  function dragended(d) {
    if (!d3.event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }
}
