## Instagram social graph

Draws who-follows-whom among the people who follow you on Instagram, as an interactive graph. Friend groups show up as clusters.

### Use it (Chrome extension)

1. Clone this repo, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the [`extension/`](./extension) folder.
2. Log in to [instagram.com](https://www.instagram.com) in that browser.
3. Click the extension icon → **Start**. It lists your followers, then asks Instagram, for each of them, which accounts you follow also follow them.
4. Leave it running. Progress and time left show in the popup; the icon badge shows the percentage. You can close the popup, pause and resume, or restart the browser — progress is saved.
5. **View graph** opens the graph in a new tab. **Copy share link** copies a link to it.

### Share links

A share link carries the graph inside itself, after the `#`, which browsers never send to a server, so nothing is stored anywhere: ~15 000 characters for 462 people and 9 661 connections. It opens on [sebasfavaron.github.io/IG-Social-Graph-Tool](https://sebasfavaron.github.io/IG-Social-Graph-Tool/), no extension needed. The link also keeps who is selected, which group is kept on, and the zoom; on that page the address bar always holds the current link, so copying it works too. Anyone who gets the link sees those usernames and who follows whom.

The page is the extension's viewer, published from `extension/` by [`.github/workflows/pages.yml`](./.github/workflows/pages.yml) on every push to `main` that touches it.

Everything stays in your browser: requests go from an instagram.com tab with your own session, and the data lives in the extension's local storage.

### Limits and gotchas

- **Speed.** One request every ~6 s by default (Settings). A follower with many mutuals takes more than one request. 500 followers ≈ 1 hour.
- **Instagram pushing back.** If Instagram answers "please wait" or HTTP 429, the crawl pauses on its own for 15 min, doubling up to 2 h, and resumes. If it asks you to confirm it's you, the popup says so; finish the check on instagram.com and press Resume.
- **Keep an instagram.com tab open.** The extension opens one in the background if there is none, and marks it so Memory Saver does not discard it.
- **Followers to check** (Settings) caps the second phase, handy for a quick first look. Raise it later and Resume to continue.
- **Loners**, accounts with a single connection (usually shops and meme pages that only follow you), stay hidden until you select the person they're linked to, so each legend group shows everyone its count includes.
- **"You follow" only counts people who follow at least one of your followers**: Instagram's "followed by" lists, the only place the crawl learns whom you follow, name no one else.

### Develop

- `extension/lib/crawler.js` has the crawl logic with no `chrome.*` calls; `npm test` runs it, and the share-link format, against a fake Instagram.
- After editing, hit the reload icon on the extension's card in `chrome://extensions`.
- Endpoints used (web app id `936619743392459`): `/api/v1/friendships/{pk}/followers/` and `/api/v1/friendships/{pk}/mutual_followers/`, paginated with `max_id` / `next_max_id`.

### Credits

- [D3.js v4 Force Directed Graph with Labels](https://gist.github.com/heybignick/3faf257bbbbc7743bb72310d03b86ee8)
