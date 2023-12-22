javascript: (async () => {
  async function getMutualFriendsFetch(user) {
    const mutualFriendsRes = await fetch(
      `https://www.instagram.com/api/v1/friendships/${user.pk}/mutual_followers/`,
      {
        headers: {
          'x-ig-app-id': '936619743392459',
        },
      }
    );
    let mutualFriends = await mutualFriendsRes.json();
    return mutualFriends.users.map((mutualFriend) => mutualFriend.username);
  }

  async function getMutualFriends(user, graph) {
    const mutualFriends = await getMutualFriendsFetch(user);

    graph.nodes = graph.nodes.concat(
      mutualFriends.map((mutualFriend) => ({ id: mutualFriend, group: 1 }))
    );
    graph.links = graph.links.concat(
      mutualFriends.map((mutualFriend) => ({
        source: mutualFriend,
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
        results.edges.map(({ node }) => ({ id: node.username, group: 1 }))
      );
      graph.links = graph.links.concat(
        results.edges.map(({ node }) => ({
          source: node.username,
          target: username,
          value: 1,
        }))
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

  async function makeGraph(loggedUsername, graph) {
    try {
      if (!graph.metadata.loggedUserFetched) {
        console.log(`Getting user info for ${loggedUsername}...`);
        await addUserInfoToGraph(loggedUsername, graph, getLoggedFollowers);
        graph.metadata.loggedUserFetched = true;
        graph.metadata.followersFetched = graph.nodes.reduce(
          (followers, follower) => {
            if (follower.id !== loggedUsername) {
              followers[follower.id] = false;
            }
            return followers;
          },
          {}
        );
      } else {
        console.log(`Already fetched user info for ${loggedUsername}...`);
      }

      const followers = Object.entries(graph.metadata.followersFetched);
      let processingCount = 0;
      const processedPercentage = (count) =>
        Math.round((100 * 100 * count) / followers.length) / 100;
      for (const [follower, fetched] of followers) {
        processingCount++;
        console.log(
          `${processedPercentage(processingCount)}% - ${
            fetched ? 'Already fetched' : 'Getting'
          } user info for ${follower}...`
        );
        if (!fetched) {
          await addUserInfoToGraph(follower, graph, getMutualFriends);
          graph.metadata.followersFetched[follower] = true;
        }
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

  function getPreviousGraph() {
    function closeModal(modal) {
      modal.parentNode.removeChild(modal);
    }

    return new Promise(function (resolve, reject) {
      let modal = document.createElement('div');
      modal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 100;">
          <div style="background-color: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; align-items: center; width: 300px;">
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 20px; color: #333;">Upload previous graph</div>
            <input type="file" style="border: none; padding: 10px; margin-bottom: 20px; border-radius: 5px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); color: #333;">
            <button style="background-color: #f0f0f0; border: none; padding: 10px; border-radius: 5px; cursor: pointer; font-weight: bold; color: #333;">Close</button>
          </div>
        </div>
      `;
      let input = modal.querySelector('input');
      let closeButton = modal.querySelector('button');
      input.onchange = function () {
        let file = input.files[0];
        if (file) {
          let reader = new FileReader();
          reader.onload = function () {
            let checkpoint = JSON.parse(reader.result);
            closeModal(modal);
            resolve(checkpoint);
          };
          reader.readAsText(file);
        }
      };
      closeButton.onclick = function () {
        closeModal(modal);
        resolve({
          metadata: {
            loggedUsername,
            loggedUserFetched: false,
            followersFetched: {},
            lastRun: new Date().toISOString(),
          },
          nodes: [],
          links: [],
        });
      };
      document.body.appendChild(modal);
    });
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

  console.log('Starting...');
  let graph = await getPreviousGraph();
  graph = await makeGraph(loggedUsername, graph);
  downloadData(graph);
  console.log('Done getting user info.');
})();
