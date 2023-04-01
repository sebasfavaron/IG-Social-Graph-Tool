export function drawGraph({ nodes, links }) {
  // Set up the SVG element and add the nodes and links
  const svg = d3.select('svg'),
    width = window.innerWidth,
    height = window.innerHeight;

  const container = svg.append('g').attr('class', 'container');

  const nodeCircleSize = 2;
  const textSize = 12;
  const linksStrokeWidth = 1;
  const circlesStrokeWidth = 0.5;
  const textsDx = 10;
  const textsDy = 0.35;
  // Add zoom behavior to the SVG element
  const zoom = d3
    .zoom()
    .scaleExtent([0.01, 40])
    .on('zoom', (e) => {
      const { x, y, k } = d3.event.transform;
      container.attr('transform', `translate(${x}, ${y}) scale(${k})`);
      // node.attr(
      //   'transform',
      //   (d) => `translate(${d.x},${d.y}) scale(${1 / d3.event.transform.k})`
      // );
      circles
        .attr('r', nodeCircleSize / k)
        .attr('stroke-width', circlesStrokeWidth / k);
      if (k > 1) {
        texts.attr('font-size', (d) => textSize / k);
      } else {
        texts.attr('font-size', (d) => 0);
      }
      texts.attr('dx', textsDx / k).attr('dy', `${textsDy / k}em`);
      link.style('stroke-width', (d) => linksStrokeWidth / k);
    });
  svg.call(zoom);

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
    .attr('fill', '#000')
    .attr('stroke', '#fff')
    .attr('stroke-width', circlesStrokeWidth);

  const texts = node
    .append('text')
    .text((d) => d.id)
    .attr('dx', textsDx)
    .attr('dy', `${textsDy}em`)
    .attr('font-size', `${textSize}px`)
    .attr('font-family', 'Arial');

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
