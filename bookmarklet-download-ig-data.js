javascript: (async () => {
  const SocialType = {
    FOLLOWERS: "followers",
    FOLLOWINGS: "followings",
  };

  async function getSocialChunk(user, socialObject, graph) {
    let after = null;
    let has_next = true;
    let count = 0,
      step = Math.min(socialObject.limit, 50);
    if (
      socialObject.type !== SocialType.FOLLOWERS &&
      socialObject.type !== SocialType.FOLLOWINGS
    ) {
      throw new Error("Invalid social type");
    }

    while (has_next && count < socialObject.limit && step > 0) {
      await fetch(
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
      )
        .then((res) => res.json())
        .then((res) => {
          count += step;
          let username = user.username;
          let results;

          if (socialObject.type === SocialType.FOLLOWERS) {
            ({ edge_followed_by: results } = res.data.user);
          } else if (socialObject.type === SocialType.FOLLOWINGS) {
            ({ edge_follow: results } = res.data.user);
          }

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
            results.edges
              .filter(
                ({ node }) =>
                  graph.links.findIndex(
                    (n) => n && n.id && n.id === node.username
                  ) === -1
              )
              .map(({ node }) => {
                if (socialObject.type === SocialType.FOLLOWERS) {
                  return {
                    source: node.username,
                    target: username,
                    value: 1,
                  };
                } else if (socialObject.type === SocialType.FOLLOWINGS) {
                  return {
                    source: username,
                    target: node.username,
                    value: 1,
                  };
                }
              })
          );
        });
    }
  }

  async function getUserGraph(
    username = "",
    graph = { nodes: [], links: [] },
    followerLimit = 100,
    followingLimit = 100
  ) {
    if (!username) throw new Error("Username is required");
    console.log(`Making graph for ${username}...`);

    try {
      let followers = {
        type: SocialType.FOLLOWERS,
        fetchHash: "c76146de99bb02f6415203be841dd25a",
        limit: followerLimit,
      };
      let followings = {
        type: SocialType.FOLLOWINGS,
        fetchHash: "d04b0a864b4b54837c0d870b0e77e076",
        limit: followingLimit,
      };
      if (!graph.nodes.find((n) => n && n.id && n.id === username)) {
        graph.nodes.push({ id: username, group: 1 });
      }

      const userQueryRes = await fetch(
        `https://www.instagram.com/web/search/topsearch/?query=${username}/`
      );

      const userQueryJson = await userQueryRes.json();

      const user = userQueryJson.users[0].user;

      await getSocialChunk(user, followers, graph);
      await getSocialChunk(user, followings, graph);

      return graph;
    } catch (err) {
      console.log({ err });
    }
  }

  async function makeGraph(centralUsername) {
    console.log(
      `Getting user info for ${centralUsername}. This may take a 15-20 seconds...`
    );

    const graph = await getUserGraph(
      centralUsername,
      {
        nodes: [],
        links: [],
      },
      100,
      0
    );
    await Promise.all(graph.nodes.map((n) => getUserGraph(n.id, graph, 2, 2)));

    return graph;
  }

  function downloadData(data) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], {
        type: "text/plain",
      })
    );
    a.setAttribute("download", "ig-social-data.json");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const graph = await makeGraph(window._sharedData.config.viewer.username);
  downloadData(graph);
  console.log("Done getting user info.");
})();
