export function drawGraph(graph) {
  var svg = d3.select('svg'),
    width = window.innerWidth,
    height = window.innerHeight;

  var color = d3.scaleOrdinal(d3.schemeCategory20);

  var simulation = d3
    .forceSimulation()
    .force(
      'link',
      d3
        .forceLink()
        .id((d) => d.id)
        .distance(0)
        .strength(0.1)
    )
    .force('charge', d3.forceManyBody().strength(-100))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force(
      'collide',
      d3.forceCollide((d) => 10)
    );

  var link = svg
    .append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(graph.links)
    .enter()
    .append('line')
    .attr('stroke-width', (d) => Math.sqrt(d.value))
    .attr('stroke', (_) => 1);

  const node = svg
    .append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(graph.nodes)
    .enter()
    .append('g');

  var circles = node
    .append('circle')
    .attr('r', 4)
    .attr('fill', '#000')
    .attr('stroke', '#000')
    .attr('stroke-width', 0.1);

  // Create a drag handler and append it to the node object instead
  var drag_handler = d3
    .drag()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended);

  drag_handler(node);

  var labels = node
    .append('text')
    .text(function (d) {
      return d.id;
    })
    .style('font', '12px Arial')
    .attr('x', -20)
    .attr('y', 15);

  node.append('title').text(function (d) {
    return d.id;
  });

  setTimeout(() => {
    simulation.alphaTarget(0);
  }, 1000);

  simulation.nodes(graph.nodes).on('tick', () => {
    ticked();
  });

  simulation.force('link').links(graph.links);

  function ticked() {
    link
      .attr('x1', function (d) {
        return d.source.x;
      })
      .attr('y1', function (d) {
        return d.source.y;
      })
      .attr('x2', function (d) {
        return d.target.x;
      })
      .attr('y2', function (d) {
        return d.target.y;
      });

    node.attr('transform', function (d) {
      return 'translate(' + d.x + ',' + d.y + ')';
    });
  }

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
