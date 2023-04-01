javascript: (async () => {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getMutualFriendsFetch(user) {
    const mutualFriendsRes = await fetch(
      `https://www.instagram.com/api/v1/friendships/${user.pk}/mutual_followers/`,
      {
        headers: {
          'x-ig-app-id': '936619743392459',
        },
      }
    );
    await sleep(500);
    let mutualFriends = await mutualFriendsRes.json();
    return mutualFriends.users.map((mutualFriend) => mutualFriend.username);
  }

  async function getMutualFriends(user, graph) {
    const mutualFriends = await getMutualFriendsFetch(user);

    graph.nodes = graph.nodes.concat(
      mutualFriends.map((mutualFriend) => {
        return { id: mutualFriend, group: 1 };
      })
    );
    graph.links = graph.links.concat(
      mutualFriends.map((mutualFriendUsername) => ({
        source: mutualFriendUsername,
        target: user.username,
        value: 1,
      }))
    );
  }

  async function getLoggedFollowersFetch(pk, step, after) {
    const res = await fetch(
      `https://www.instagram.com/graphql/query/?query_hash=c76146de99bb02f6415203be841dd25a&variables=` +
        encodeURIComponent(
          JSON.stringify({
            id: pk,
            include_reel: true,
            fetch_mutual: true,
            first: step,
            after: after,
          })
        ),
      {
        headers: {
          'x-ig-app-id': '936619743392459',
        },
      }
    );

    const jsonRes = await res.json();
    return jsonRes.data.user.edge_followed_by;
  }

  async function getLoggedFollowers(user, graph) {
    let after = null,
      has_next = true,
      count = 0,
      step = 500,
      limit = 500,
      username = user.username;

    while (has_next && count < limit) {
      let results = await getLoggedFollowersFetch(user.pk, step, after);
      has_next = results.page_info.has_next_page;
      after = results.page_info.end_cursor;
      count += results.edges.length;
      graph.nodes = graph.nodes.concat(
        results.edges.map(({ node }) => {
          return { id: node.username, group: 1 };
        })
      );
      graph.links = graph.links.concat(
        results.edges.map(({ node }) => {
          return {
            source: node.username,
            target: username,
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
    infoFetchFn = async () => {}
  ) {
    if (!username) throw new Error('Username is required');

    console.log(`Getting user info for ${username}...`);
    if (!graph.nodes.find((n) => n && n.id && n.id === username)) {
      graph.nodes.push({ id: username, group: 1 });
    }

    let user = await getUserInfo(username);
    await infoFetchFn(user, graph);
  }

  function deduped(array, key) {
    return array.reduce((acc, current) => {
      const x = acc.find((item) => item[key] === current[key]);
      if (!x) {
        acc.push(current);
      }
      return acc;
    }, []);
  }

  async function makeGraph(loggedUsername) {
    const graph = {
      nodes: [],
      links: [],
    };
    try {
      await addUserInfoToGraph(loggedUsername, graph, getLoggedFollowers);
      const followers = graph.nodes
        .map((n) => n.id)
        .filter((n) => n !== undefined && n !== loggedUsername);
      for (const follow of followers) {
        await addUserInfoToGraph(follow, graph, getMutualFriends);
      }
    } catch (err) {
      console.log({ err });
    }
    graph.nodes = deduped(graph.nodes, 'id');

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
      'Could not find logged username. Please make sure you are in instagram and are logged in.'
    );
    return;
  }
  console.log(
    `Getting user info for ${loggedUsername}. This may take a 15-20 seconds...`
  );
  const graph = await makeGraph(loggedUsername);
  graph.username = loggedUsername;
  downloadData(graph);

  console.log('Done getting user info.');
})();
