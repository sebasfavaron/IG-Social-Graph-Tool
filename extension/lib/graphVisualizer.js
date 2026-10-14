// onViewChange(byUser) fires on every zoom/pan; byUser is false for programmatic moves
// (fit on load, panning to a searched person).
// hidden: ids drawn and laid out but kept out of sight (loners) until a selected person's
// links reach them, so the legend's counts match what its groups show.
export function drawGraph({ nodes, links }, { onViewChange, hidden = new Set() } = {}) {
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
  // ~0.04 for a few thousand links (where they pile up into clusters); small graphs need
  // their few lines visible
  const linkOpacity = Math.min(0.35, Math.max(0.04, 4 / Math.sqrt(links.length || 1)));
  const linkColor = '#868585';

  // Set up the SVG element and add the nodes and links
  const svg = d3.select('svg'),
    viewSize = () => ({
      w: svg.node().clientWidth || window.innerWidth,
      h: svg.node().clientHeight || window.innerHeight,
    }),
    { w: width, h: height } = viewSize();

  const container = svg.append('g').attr('class', 'container');

  // Arrowheads sit at the end of a link, on the person being followed, in the link's
  // colour. refX backs the tip off so it stops at the edge of the (selected, 2x) circle.
  const defs = container.append('defs');
  function arrowFor(color) {
    const id = `arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
    if (defs.select(`#${id}`).empty()) {
      defs
        .append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 17)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('fill', color)
        .attr('orient', 'auto')
        .attr('markerUnits', 'strokeWidth')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('class', 'arrowhead');
    }
    return `url(#${id})`;
  }

  const link = container
    .selectAll('.link')
    .data(links)
    .enter()
    .append('line')
    .attr('class', 'link')
    .classed('loner', (d) => hidden.has(d.source) || hidden.has(d.target));

  // Elements by username / by "source\0target". Looked up through maps, not DOM ids:
  // ids built from usernames collided once dots and underscores were stripped
  // (jose.favaron vs josefavaron), and the second one never lit up.
  const linkByKey = new Map();
  link.each(function (d) {
    linkByKey.set(`${d.source}\u0000${d.target}`, this);
  });

  const node = container
    .selectAll('.node')
    .data(nodes)
    .enter()
    .append('g')
    .attr('class', 'node')
    .classed('loner', (d) => hidden.has(d.id))
    .call(
      d3
        .drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended)
    );
  const nodeById = new Map();
  node.each(function (d) {
    nodeById.set(d.id, this);
  });

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

      link.style('stroke-opacity', linkOpacity).style('stroke', linkColor);

      // Hide all arrows
      link.attr('marker-end', null);
      container.selectAll('.loner').style('display', 'none');
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

        node.style('opacity', 1).style('display', null);
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
      onViewChange?.(!!d3.event.sourceEvent);
    });
  svg.call(zoom);

  function getUsersFriendLinks(username) {
    const followings = links.filter((link) => link.source.id === username);
    const followers = links.filter((link) => link.target.id === username);
    const friendships = followers.filter((follower) =>
      followings.some((following) => following.target.id === follower.source.id)
    );
    friendships.forEach((friendship) => {
      followers.splice(followers.indexOf(friendship), 1);
      followings.splice(
        followings.findIndex(
          (following) => following.target.id === friendship.source.id
        ),
        1
      );
    });

    return {
      followings,
      followers,
      friendships,
    };
  }

  // Add click listeners
  const categoryColors = { follower: '#ca2d2d', following: 'green', mutual: 'purple' };
  let selection = null; // { element, username, links: { follower, following, mutual } }

  function setLinkStyle(link, color, username) {
    // light up the other person on the link, not the clicked one
    const other = link.source.id === username ? link.target : link.source;
    d3.select(nodeById.get(other.id)).style('opacity', 0.8).style('display', null);

    const linkElement = linkByKey.get(`${link.source.id}\u0000${link.target.id}`);
    linkElement.style.display = '';
    linkElement.style.strokeOpacity = 0.8;
    linkElement.style.stroke = color;
    linkElement.setAttribute('marker-end', arrowFor(color));
    const oppositeLinkElement = linkByKey.get(`${link.target.id}\u0000${link.source.id}`);
    // a mutual link is drawn once; the reverse line gets the second arrowhead
    if (oppositeLinkElement) {
      oppositeLinkElement.setAttribute('marker-end', arrowFor(color));
    }
  }

  // Paints the selected node and its links; `only` limits it to one category.
  function paintSelection(only = null) {
    if (!selection) return;
    styleManager.setBackgroundNodesStyles();
    styleManager.clickedNode.setNode(selection.element);
    styleManager.clickedNode.setStyles();
    for (const [category, categoryLinks] of Object.entries(selection.links)) {
      if (only && only !== category) continue;
      categoryLinks.forEach((link) =>
        setLinkStyle(link, categoryColors[category], selection.username)
      );
    }
  }

  function selectNode(username, element) {
    const { followers, followings, friendships } = getUsersFriendLinks(username);
    selection = {
      element,
      username,
      links: { follower: followers, following: followings, mutual: friendships },
    };
    paintSelection();
  }

  node.on('click', function (event) {
    d3.event.stopPropagation();
    selectNode(event.id, d3.select(this));
  });
  d3.select('body').on('click', () => {
    selection = null;
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
  const render = () => {
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);

    // Set the position of the links
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);
  };
  simulation.on('tick', render);

  // Settle the layout up front instead of animating it: the animation runs on
  // requestAnimationFrame, which stops in background tabs and left the graph
  // half-laid-out in a corner. Then zoom so the whole graph fits the screen.
  simulation.stop();
  const ticks = Math.ceil(
    Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())
  );
  for (let i = 0; i < ticks; i++) simulation.tick();
  render();

  // A tab opened in the background can report a 0x0 size; fit once it has one.
  function fitToView() {
    const { w, h } = viewSize();
    if (!w || !h) return window.addEventListener('resize', fitToView, { once: true });
    const visible = nodes.filter((d) => !hidden.has(d.id));
    const xs = visible.map((d) => d.x);
    const ys = visible.map((d) => d.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const fitK = Math.min(4, 0.9 * Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1)));
    svg.call(
      zoom.transform,
      d3.zoomIdentity
        .translate(w / 2 - (fitK * (minX + maxX)) / 2, h / 2 - (fitK * (minY + maxY)) / 2)
        .scale(fitK)
    );
  }
  fitToView();

  // Views are stored relative to the layout's centroid, so a view saved on one screen
  // size lands on the same spot on another (the layout is centred on the viewport).
  const centroid = {
    x: nodes.reduce((sum, d) => sum + d.x, 0) / nodes.length,
    y: nodes.reduce((sum, d) => sum + d.y, 0) / nodes.length,
  };

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

  return {
    hasSelection: () => selection !== null,
    selected: () => selection?.username ?? null,
    // null shows all three categories again
    showOnly: (category) => paintSelection(category),
    ids: () => nodes.map((d) => d.id),
    // Selects a person as if clicked and pans to them, zooming in enough to read names.
    // Selects a person as if clicked, without moving the view.
    select: (username) => {
      const element = node.filter((d) => d.id === username);
      if (element.empty()) return false;
      selectNode(username, element);
      return true;
    },
    view: () => {
      const t = d3.zoomTransform(svg.node());
      const { w, h } = viewSize();
      return { x: (w / 2 - t.x) / t.k - centroid.x, y: (h / 2 - t.y) / t.k - centroid.y, k: t.k };
    },
    setView: ({ x, y, k }) => {
      const { w, h } = viewSize();
      svg.call(
        zoom.transform,
        d3.zoomIdentity.translate(w / 2 - k * (x + centroid.x), h / 2 - k * (y + centroid.y)).scale(k)
      );
    },
    focus: (username) => {
      const element = node.filter((d) => d.id === username);
      if (element.empty()) return false;
      selectNode(username, element);
      const d = element.datum();
      const k = Math.max(d3.zoomTransform(svg.node()).k, 2);
      const { w, h } = viewSize();
      svg
        .transition()
        .duration(600)
        .call(zoom.transform, d3.zoomIdentity.translate(w / 2 - k * d.x, h / 2 - k * d.y).scale(k));
      return true;
    },
    counts: () =>
      selection &&
      Object.fromEntries(Object.entries(selection.links).map(([c, l]) => [c, l.length])),
  };
}
