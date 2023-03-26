javascript: (async () => {
  const SocialType = {
    FOLLOWERS: 'followers',
    FOLLOWINGS: 'followings',
  };

  function memoize(fn) {
    let cache = {};
    return (...args) => {
      let n = args[0];
      if (n in cache) {
        return cache[n];
      } else {
        let result = fn(n);
        cache[n] = result;
        return result;
      }
    };
  }

  async function getMutualFriends({ username, pk, graph }) {
    const mutualFriendsRes = await fetch(
      `https://www.instagram.com/api/v1/friendships/${pk}/mutual_followers/`,
      {
        headers: {
          accept: '*/*',
          'accept-language':
            'en-US,en;q=0.9,it-IT;q=0.8,it;q=0.7,es-AR;q=0.6,es;q=0.5',
          'sec-ch-prefers-color-scheme': 'dark',
          'sec-ch-ua':
            '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'viewport-width': '1512',
          'x-asbd-id': '198387',
          'x-csrftoken': '7Vs0XofofZJ5qslzJdxvI0CUNBaAal1n',
          'x-ig-app-id': '936619743392459',
          'x-ig-www-claim':
            'hmac.AR0qVk7mQ5JK8qsBmy-AEVB9e9EtWlKmdXwjPKgwiMy85l1f',
          'x-requested-with': 'XMLHttpRequest',
        },
        referrer: `https://www.instagram.com/${username}/followers/mutualOnly`,
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: null,
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
      }
    );
    let mutual = await mutualFriendsRes.json();
    mutual = mutual.users.map((friend) => friend.username);
    graph.nodes = graph.nodes.concat(
      mutual
        .filter(
          (username) =>
            graph.nodes.findIndex((n) => n && n.id && n.id === username) === -1
        )
        .map((username) => ({ id: username, group: 1 }))
    );
    graph.links = graph.links.concat(
      mutual.map((mutualUsername) => ({
        source: mutualUsername,
        target: username,
        value: 1,
      }))
    );
  }

  async function getLoggedUserSocialCircle(user, socialObject, graph) {
    if (
      socialObject.type !== SocialType.FOLLOWERS &&
      socialObject.type !== SocialType.FOLLOWINGS
    ) {
      throw new Error('Invalid social type');
    }
    let after = null;
    let has_next = true;
    let count = 0,
      step = Math.min(socialObject.limit, 500);
    let username = user.username;
    let isFollower = socialObject.type === SocialType.FOLLOWERS;

    while (has_next && count < socialObject.limit && step > 0) {
      const res = await fetch(
        `https://www.instagram.com/graphql/query/?query_hash=${socialObject.fetchHash}&variables=` +
          encodeURIComponent(
            JSON.stringify({
              id: user.pk,
              include_reel: true,
              fetch_mutual: true,
              first: step,
              after: after,
            })
          )
      );
      const jsonRes = await res.json();

      count += step;
      let results = isFollower
        ? jsonRes.data.user.edge_followed_by
        : jsonRes.data.user.edge_follow;
      has_next = results.page_info.has_next_page;
      after = results.page_info.end_cursor;
      graph.nodes = graph.nodes.concat(
        results.edges
          .filter(
            ({ node }) =>
              graph.nodes.findIndex(
                (n) => n && n.id && n.id === node.username
              ) === -1
          )
          .map(({ node }) => {
            return { id: node.username, group: 1 };
          })
      );
      graph.links = graph.links.concat(
        results.edges.map(({ node }) => {
          return {
            source: isFollower ? node.username : username,
            target: isFollower ? username : node.username,
            value: 1,
          };
        })
      );
    }
  }

  async function getUserInfo(username) {
    const userQueryRes = await fetch(
      `https://www.instagram.com/web/search/topsearch/?query=${username}/`
    );
    const userQueryJson = await userQueryRes.json();
    if (
      !userQueryJson.users ||
      userQueryJson.users.length === 0 ||
      !userQueryJson.users[0].user
    ) {
      throw new Error('User not found');
    }
    return userQueryJson.users[0].user;
  }

  async function addUserInfoToGraph(
    username = '',
    graph,
    infoFetchFn = () => {}
  ) {
    try {
      if (!username) throw new Error('Username is required');
      console.log(`Making subgraph for ${username}...`);

      if (!graph.nodes.find((n) => n && n.id && n.id === username)) {
        graph.nodes.push({ id: username, group: 1 });
      }

      let user = getUserInfo(username);
      await infoFetchFn(user, graph);
    } catch (err) {
      console.log({ err });
    }
  }

  async function makeGraph(loggedUsername) {
    const graph = {
      nodes: [],
      links: [],
    };
    await addUserInfoToGraph(loggedUsername, graph, async (user, graph) => {
      let followers = {
        type: SocialType.FOLLOWERS,
        fetchHash: 'c76146de99bb02f6415203be841dd25a',
        limit: 1,
      };
      await getLoggedUserSocialCircle(user, followers, graph);

      let followings = {
        type: SocialType.FOLLOWINGS,
        fetchHash: 'd04b0a864b4b54837c0d870b0e77e076',
        limit: 0,
      };
      await getLoggedUserSocialCircle(user, followings, graph);
    });
    await Promise.all(
      graph.nodes.map((n) =>
        addUserInfoToGraph(n.id, graph, async (user, graph) => {
          await getMutualFriends({
            username: user.username,
            pk: user.pk,
            graph,
          });
        })
      )
    );

    return graph;
  }

  function downloadData(data, format = 'json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], {
        type: 'text/plain',
      })
    );
    a.setAttribute('download', `ig-social-data.${format}`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  let loggedUsername;
  try {
    loggedUsername = window._sharedData.config.viewer.username;
  } catch (_) {
    loggedUsername = undefined;
  }
  if (loggedUsername === '' || loggedUsername === undefined) {
    alert(
      "Couldn't find logged username. Please make sure you are in instagram and are logged in."
    );
    return;
  }
  console.log(
    `Getting user info for ${loggedUsername}. This may take a 15-20 seconds...`
  );
  const graph = await makeGraph(loggedUsername);
  downloadData(graph);
  console.log('Done getting user info.');
})();
