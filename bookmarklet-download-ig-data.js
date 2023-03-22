javascript: (async () => {
  async function getUserInfo(username = "") {
    if (!username) throw new Error("Username is required");
    try {
      let followers = [{ username: "", full_name: "" }];
      let followings = [{ username: "", full_name: "" }];

      followers = [];
      followings = [];
      const userQueryRes = await fetch(
        `https://www.instagram.com/web/search/topsearch/?query=${username}/`
      );

      const userQueryJson = await userQueryRes.json();

      const userId = userQueryJson.users[0].user.pk;

      let after = null;
      let has_next = true;

      while (has_next) {
        await fetch(
          `https://www.instagram.com/graphql/query/?query_hash=c76146de99bb02f6415203be841dd25a&variables=` +
            encodeURIComponent(
              JSON.stringify({
                id: userId,
                include_reel: true,
                fetch_mutual: true,
                first: 50,
                after: after,
              })
            )
        )
          .then((res) => res.json())
          .then((res) => {
            has_next = res.data.user.edge_followed_by.page_info.has_next_page;
            after = res.data.user.edge_followed_by.page_info.end_cursor;
            followers = followers.concat(
              res.data.user.edge_followed_by.edges.map(({ node }) => {
                return {
                  username: node.username,
                  full_name: node.full_name,
                };
              })
            );
          });
      }

      after = null;
      has_next = true;

      while (has_next) {
        await fetch(
          `https://www.instagram.com/graphql/query/?query_hash=d04b0a864b4b54837c0d870b0e77e076&variables=` +
            encodeURIComponent(
              JSON.stringify({
                id: userId,
                include_reel: true,
                fetch_mutual: true,
                first: 50,
                after: after,
              })
            )
        )
          .then((res) => res.json())
          .then((res) => {
            has_next = res.data.user.edge_follow.page_info.has_next_page;
            after = res.data.user.edge_follow.page_info.end_cursor;
            followings = followings.concat(
              res.data.user.edge_follow.edges.map(({ node }) => {
                return {
                  username: node.username,
                  full_name: node.full_name,
                };
              })
            );
          });
      }

      return {
        followers,
        followings,
      };
    } catch (err) {
      console.log({ err });
    }
  }

  async function makeGraph(centralUsername) {
    console.log(
      `Getting user info for ${centralUsername}. This may take a 15-20 seconds...`
    );

    const { followers, followings } = await getUserInfo(centralUsername);
    console.log({ followers, followings });
    const graph = {
      nodes: [{ id: centralUsername, group: 1 }],
      links: [],
    };
    followers.forEach((follower) => {
      graph.nodes.push({ id: follower.username, group: 1 });
      graph.links.push({
        source: follower.username,
        target: centralUsername,
        value: 1,
      });
    });
    followings.forEach((following) => {
      graph.links.push({
        source: centralUsername,
        target: following.username,
        value: 1,
      });

      const alreadyExists = graph.nodes.find(
        (node) => node.id === following.username
      );
      if (alreadyExists) return;
      graph.nodes.push({ id: following.username, group: 1 });
    });

    const graph1 = {
      nodes: [
        { id: centralUsername, group: 1 },
        { id: "other", group: 1 },
      ],
      links: [{ source: centralUsername, target: "other", value: 1 }],
    };
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

  const graph = await makeGraph("sebas.favaron");
  downloadData(graph);
})();
