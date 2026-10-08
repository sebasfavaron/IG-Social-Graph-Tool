(() => {
  const QUERY_HASH = 'c76146de99bb02f6415203be841dd25a';

  function showToast(message) {
    let toast = document.getElementById('social-circle-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'social-circle-toast';
      toast.style.position = 'fixed';
      toast.style.top = '16px';
      toast.style.right = '16px';
      toast.style.zIndex = '1000000';
      toast.style.padding = '10px 14px';
      toast.style.borderRadius = '999px';
      toast.style.background = 'rgba(0,0,0,0.8)';
      toast.style.color = '#fff';
      toast.style.font = '12px/1.4 Arial, sans-serif';
      toast.style.boxShadow = '0 10px 24px rgba(0,0,0,0.2)';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    clearTimeout(showToast.timeoutId);
    showToast.timeoutId = setTimeout(() => {
      toast.remove();
    }, 2500);
  }

  async function fetchInstagramJson(url, options = {}) {
    const headers = {
      'x-ig-app-id': '936619743392459',
      ...(options.headers || {}),
    };

    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Instagram request failed (${response.status})`);
    }

    return response.json();
  }

  function getLoggedUserFromWindow() {
    // Try multiple locations where Instagram stores viewer data
    // 1. Try window._sharedData (older pages)
    try {
      const viewer = window._sharedData?.config?.viewer;
      if (viewer?.username && viewer?.pk) return viewer;
    } catch (e) {
      // silent fail
    }

    // 2. Try extracting from DOM - username in URL for profile pages
    const profileMatch = window.location.pathname.match(/^\/([a-zA-Z0-9_.]+)\/?$/);
    if (profileMatch) {
      const username = profileMatch[1];
      
      // Try to extract pk from the page HTML
      const htmlString = document.documentElement.outerHTML;
      const pkMatch = htmlString.match(/"id":"(\d+)".*?"username":"/ );
      
      if (pkMatch) {
        return {
          username,
          pk: parseInt(pkMatch[1], 10),
        };
      }
    }

    // 3. Try to get from any window object with user data
    try {
      for (const key in window) {
        if (key.includes('viewer') || key.includes('user')) {
          const obj = window[key];
          if (obj?.username && obj?.pk) {
            return obj;
          }
        }
      }
    } catch (e) {
      // silent fail
    }

    return null;
  }

  function fileNameFromUsername(username) {
    return `${(username || 'ig-social-circle').replace(/\s+/g, '-').toLowerCase()}.json`;
  }

  function dedupeNodes(nodes) {
    const seen = new Set();
    return nodes.filter((node) => {
      const id = node && node.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function dedupeLinks(links) {
    const seen = new Set();
    return links.filter((link) => {
      const key = `${link.source}::${link.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function collectFollowersGraph() {
    const viewer = getLoggedUserFromWindow();
    if (!viewer || !viewer.username || !viewer.pk) {
      throw new Error('Unable to find your Instagram profile data. Please make sure:\n1. You are signed in to Instagram\n2. You are on your own profile page (not another user\'s profile)\n3. The page has fully loaded\n\nIf this persists, Instagram may have changed how they store user data.');
    }

    const graph = {
      username: viewer.username,
      metadata: {
        loggedUserFetched: true,
        source: 'browser-extension',
        lastRun: new Date().toISOString(),
      },
      nodes: [{ id: viewer.username, group: 1 }],
      links: [],
    };

    let after = null;
    let hasNextPage = true;
    let processed = 0;
    const maxFollowers = 500;

    showToast(`Collecting ${viewer.username}'s followers...`);

    while (hasNextPage && processed < maxFollowers) {
      const variables = {
        id: viewer.pk,
        include_reel: true,
        fetch_mutual: true,
        first: Math.min(50, maxFollowers - processed),
        after,
      };

      const queryUrl = `https://www.instagram.com/graphql/query/?query_hash=${QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
      const response = await fetchInstagramJson(queryUrl);
      const followedBy = response?.data?.user?.edge_followed_by;
      const edges = followedBy?.edges || [];

      for (const edge of edges) {
        const follower = edge?.node;
        if (!follower || !follower.username) continue;

        if (!graph.nodes.some((node) => node.id === follower.username)) {
          graph.nodes.push({ id: follower.username, group: 1 });
        }

        graph.links.push({
          source: follower.username,
          target: viewer.username,
          value: 1,
        });

        processed += 1;
      }

      hasNextPage = Boolean(followedBy?.page_info?.has_next_page);
      after = followedBy?.page_info?.end_cursor || null;
    }

    graph.nodes = dedupeNodes(graph.nodes);
    graph.links = dedupeLinks(graph.links);

    showToast(`Exported ${graph.nodes.length} nodes for ${viewer.username}.`);
    return graph;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'collectGraph') {
      return;
    }

    (async () => {
      try {
        const graph = await collectFollowersGraph();
        sendResponse({ ok: true, data: graph, filename: fileNameFromUsername(graph.username) });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error while collecting graph',
        });
      }
    })();

    return true;
  });
})();
