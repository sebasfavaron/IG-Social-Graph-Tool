## Instagram social graph

Draws who-follows-whom among the people who follow you on Instagram, as an interactive graph. Friend groups show up as clusters.

### Use it (Chrome extension)

1. Clone this repo, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the [`extension/`](./extension) folder.
2. Log in to [instagram.com](https://www.instagram.com) in that browser.
3. Click the extension icon → **Start**. It lists your followers, then asks Instagram, for each of them, which accounts you follow also follow them.
4. Leave it running. Progress and time left show in the popup; the icon badge shows the percentage. You can close the popup, pause and resume, or restart the browser — progress is saved.
5. **View graph** opens the graph in a new tab. **Download JSON** exports it in the format the [website](https://ig-social-graph.netlify.app/) and the [`graph-scripts`](./scripts/graph-scripts) read.

Everything stays in your browser: requests go from an instagram.com tab with your own session, and the data lives in the extension's local storage.

### Limits and gotchas

- **Speed.** One request every ~6 s by default (Settings). A follower with many mutuals takes more than one request. 500 followers ≈ 1 hour.
- **Instagram pushing back.** If Instagram answers "please wait" or HTTP 429, the crawl pauses on its own for 15 min, doubling up to 2 h, and resumes. If it asks you to confirm it's you, the popup says so; finish the check on instagram.com and press Resume.
- **Keep an instagram.com tab open.** The extension opens one in the background if there is none, and marks it so Memory Saver does not discard it.
- **Followers to check** (Settings) caps the second phase, handy for a quick first look. Raise it later and Resume to continue.
- Accounts connected to the graph by a single link (usually shops and meme pages that only follow you) are hidden in the viewer.

### Develop

- `extension/lib/crawler.js` has the crawl logic with no `chrome.*` calls; `npm run test:extension` runs it against a fake Instagram.
- After editing, hit the reload icon on the extension's card in `chrome://extensions`.
- Endpoints used (web app id `936619743392459`): `/api/v1/friendships/{pk}/followers/` and `/api/v1/friendships/{pk}/mutual_followers/`, paginated with `max_id` / `next_max_id`.

### Legacy

The bookmarklet (`scripts/bookmarklet-download-ig-data.js`) no longer works: Instagram blocks scripts loaded from github.io, and the GraphQL `query_hash` endpoint and `window._sharedData` it relied on are gone. The Next.js site in this repo still visualizes JSON exports. If a graph shows up stuck in a corner there, run [addMissingNodes](./scripts/graph-scripts/addMissingNodes.js) on the file; the extension's viewer handles this itself.

### Credits (tutorials that helped me hack this together):

- [Upload file](https://gomakethings.com/how-to-upload-and-process-a-json-file-with-vanilla-js/)
- [D3.js v4 Force Directed Graph with Labels](https://gist.github.com/heybignick/3faf257bbbbc7743bb72310d03b86ee8)
- Bookmarklet
  - [Creation](https://www.freecodecamp.org/news/what-are-bookmarklets/)
  - [Method to save json](https://stackoverflow.com/a/60377870)

[^1]: I left the [file](./bookmarklet-download-ig-data.js) in the repo to be able to be modified. A simple way of updating the bookmark after modification is selecting the whole file's text, and pasting it directly in the bookmark's address.
