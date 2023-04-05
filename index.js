export function drawGraph({ nodes, links }) {
  function convertToValidIdFormat(id) {
    return id.replace(/[^a-zA-Z0-9]/g, '');
  }
  function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }
  const isClientMobile = isMobile();

  // Define style values
  const nodeCircleSize = isClientMobile ? 6 : 2;
  const textSize = isClientMobile ? 24 : 12;
  const linksStrokeWidth = isClientMobile ? 2 : 1;
  const circlesStrokeWidth = isClientMobile ? 2 : 1;
  const textsDx = 10;
  const textsDy = 0.35;
  const mainColor = 'black';
  const secondaryColor = 'white';
  const linkOpacity = 0.04;
  const linkColor = '#868585';

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
    .attr('class', 'link')
    .attr('id', (d) => convertToValidIdFormat(`link-${d.source}-${d.target}`));

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
    .attr('fill', mainColor)
    .attr('stroke', secondaryColor)
    .attr('stroke-width', circlesStrokeWidth);

  const texts = node
    .append('text')
    .text((d) => d.id)
    .attr('dx', textsDx)
    .attr('dy', `${textsDy}em`)
    .attr('font-size', `${textSize}px`)
    .style('fill', mainColor)
    .attr('font-family', 'Arial');

  const stylesClass = () => {
    let k = 1;
    let clickedNode = clickedNodeClass();
    const resetStyles = () => {
      clickedNode.setNode(null);
      node.style('opacity', 1);
      node
        .select('text')
        .attr('font-size', textSize / k)
        .style('fill', mainColor)
        .style('text-shadow', 'none');
      node
        .select('circle')
        .attr('fill', mainColor)
        .attr('stroke', secondaryColor)
        .attr('r', nodeCircleSize / k);

      const links = document.querySelectorAll('[id^="link"]');
      links.forEach((link) => {
        link.style.strokeOpacity = linkOpacity;
        link.style.stroke = linkColor;
      });
    };

    return {
      setK: (newK) => {
        k = newK;
        clickedNode.setK(newK);
      },
      clickedNode,
      resetStyles,
      setBackgroundNodesStyles: () => {
        resetStyles();
        node.style('opacity', 0.1);
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
    const color = secondaryColor;
    const bgColor = mainColor;

    // Old pulp fiction look
    // const color = 'gold';
    // .style('text-shadow', '2px 2px 0px #FF0000');
    return {
      setK: (newK) => {
        k = newK;
      },
      setNode: (newNode) => {
        node = newNode;
      },
      setStyles: () => {
        if (!node) {
          return;
        }

        node.style('opacity', 1);
        node
          .select('text')
          .attr('font-size', (textSize * 2) / k)
          .style('fill', color)
          .style(
            'text-shadow',
            `1px 1px 0 ${bgColor}, 1px -1px 0 ${bgColor}, -1px 1px 0 ${bgColor}, -1px -1px 0 ${bgColor}, 1px 0px 0 ${bgColor}, 0px 1px 0 ${bgColor}, -1px 0px 0 ${bgColor}, 0px -1px 0 ${bgColor}`
          );
        node
          .select('circle')
          .attr('fill', color)
          .attr('stroke', bgColor)
          .attr('r', (nodeCircleSize * 2) / k);
      },
    };
  };
  const styleManager = stylesClass();
  styleManager.resetStyles();

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

    // Highlight the clicked node's followers and their links
    const usersFollowers = getUsersFollowers(event.id);
    usersFollowers.forEach((follower) => {
      const followerNode = d3.select(
        `#${convertToValidIdFormat(follower.source.id)}`
      );
      followerNode.style('opacity', 0.8);

      const followerLink = document.querySelector(
        '#' +
          convertToValidIdFormat(
            `link-${follower.source.id}-${follower.target.id}`
          )
      );
      followerLink.style.strokeOpacity = 0.8;
      followerLink.style.stroke = 'red';
    });
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
