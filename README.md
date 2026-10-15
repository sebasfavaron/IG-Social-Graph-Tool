## Instagram social graph

Draws who-follows-whom among the people who follow you on Instagram, as an interactive graph: your friend groups come out as coloured clusters, and clicking anyone shows who follows them, whom they follow and who follows each other.

**See it first:** open [sebasfavaron.github.io/IG-Social-Graph-Tool](https://sebasfavaron.github.io/IG-Social-Graph-Tool/) and press **Try an example** (20 made-up people in three groups).

### Map your own followers (Chrome extension)

1. Clone this repo, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the [`extension/`](./extension) folder.
2. Log in to [instagram.com](https://www.instagram.com) in that browser.
3. Click the extension icon → **Start**. It lists your followers, then asks Instagram, for each of them, which accounts you follow also follow them.
4. Leave it running. The popup shows progress and the time left, measured from the pace so far (Instagram's pauses included); the icon badge shows the percentage. You can close the popup, pause and resume, or restart the browser: progress is saved.
5. **View graph** opens the graph in a new tab. **Copy share link** copies a link anyone can open, no extension needed.

The crawl also keeps everyone's real name and profile photo, which come with the same lists at no extra request. A crawl made before that can get them with **Get names & photos** in the popup: your followers list again, about one request per 50 followers.

Requests go from an instagram.com tab with your own session, and the data stays in the extension's local storage. Nothing is sent anywhere else.

### Reading the graph

- **Friend groups** are found from who-follows-whom alone and coloured. You are left out of the grouping, since you connect to everyone. The key in the corner lists them: point at a group to highlight its people and the lines between them, click its name to rename it. Names are saved in the share link.
- **Dot size** follows the number of connections, and dots shrink as you zoom out so they never pile up. Names never overlap: the most connected people are labelled first.
- **Photos** take the place of the dots once you zoom in far enough to tell faces apart; the friend-group colour stays as a ring.
- **Search** finds people by username or real name, accents ignored ("jose" finds José).
- **Click someone**, or find them with search (`/`), to open their panel: who follows them, whom they follow and who follows each other, as lists you can click through, plus their photo, real name and a link to their Instagram. When there are more than 15 people, a filter box narrows the lists. Selecting someone zooms to fit most of their people around them. Point at a list to show only those lines; click its heading to keep it. `Esc` clears.
- **Directions** are orange and blue, which stay distinguishable with red-green colour blindness; "follow each other" is a heavier neutral line.
- **Light and dark** themes follow your system; the ☾ / ☀ button overrides it.
- **Loners**, accounts with a single connection (usually shops and meme pages that only follow you), stay hidden until you select the person they're linked to, so each group in the panel shows everyone its count includes.

**On phones** the panel is a bottom sheet with one tab per group (a tab also shows only that group's lines) and a handle that folds it down to the name. The groups key starts folded. Panning and pinching move a snapshot of the graph and redraw sharp when you let go, so they stay smooth with 10 000 lines.

**Keyboard and screen readers:** every control is a real button or field with a visible focus ring; each selection is announced ("Selected @x. 10 follow @x…"); "reduce motion" skips the pan animation.

### Share with names and photos

A share link carries usernames only. **Share with photos…** shares everything you see: the graph, real names and photos, ~3 MB for 460 people. That is too big for a link, so the viewer:

1. encrypts it in your browser with a new random key;
2. stores the encrypted bytes in a small database ([Neon](https://neon.com) Postgres);
3. copies a short link (~110 characters) with the share's id and the key after the `#`.

The database holds bytes it cannot read, and the key never reaches any server: the link is what gives access, so treat it like the data itself. Sharing the same graph again reuses its upload. Nobody needs an account or a token, and opening the link needs no extension. **Combine with a friend…** accepts these links too, and brings their names and photos along.

The browser connects with a password that is in the code, so anyone can use it, and it can do exactly two things ([`db/shares.sql`](./db/shares.sql)): save one share and get its random id back, or read one share by id. It cannot list, change or delete shares. Uploads stop at 8 MB each, 60 an hour and 400 MB in total, which keeps strangers from filling the free tier.

### Combine two people's graphs

**Combine with a friend…** takes a share link a friend made and draws both graphs as one. The key switches from friend groups to circles: the people you both know, the ones only you know, the ones only they know. Point at a circle to highlight its people. The combined graph has its own share link, and **@you only** goes back.

### Share links

A share link carries the graph inside itself, after the `#`, which browsers never send to a server, so nothing is stored anywhere: ~10 000 characters for 462 people and 10 000 connections. The format is built for these graphs: each pair of people is stored once with its direction, your own links are two bits per person, and people are numbered friend group by friend group so the people someone is connected to get nearby numbers. It also keeps who is selected, which group is kept on, the zoom and your friend-group names. On the site the address bar always holds the current link, so copying it from there works too. Anyone who gets the link sees those usernames and who follows whom. Real names and photos stay in the extension: links carry usernames only (see the next section to share those).

The site is the extension's viewer, published from `extension/` by [`.github/workflows/pages.yml`](./.github/workflows/pages.yml) on every push to `main` that touches it.

### Limits and gotchas

- **Speed.** One request every ~6 s by default (Settings). A follower with many mutuals takes more than one request. 500 followers ≈ 1 hour, more if Instagram pushes back.
- **Instagram pushing back.** If Instagram answers "please wait" or HTTP 429, the crawl pauses on its own for 15 min, doubling up to 2 h, and resumes. If it asks you to confirm it's you, the popup says so; finish the check on instagram.com and press Resume.
- **Keep an instagram.com tab open.** The extension opens one in the background if there is none, and marks it so Memory Saver does not discard it.
- **Followers to check** (Settings) caps the second phase, handy for a quick first look. Raise it later and Resume to continue.
- **"You follow" only counts people who follow at least one of your followers**: Instagram's "followed by" lists, the only place the crawl learns whom you follow, name no one else.
- **Group names in the extension** are saved per account in that browser, each with its group's most connected person, so a later crawl that renumbers the groups keeps every name on its group.
- **Photos** are saved as small copies when the crawl runs, because Instagram's photo links expire. If one fails, **Refresh names & photos** tries again with fresh links.

### Develop

- After editing, hit the reload icon on the extension's card in `chrome://extensions`. Chrome keeps the old background worker running until then, while the popup is read fresh each time.
- The share storage is the Neon project linked in `neon.ts` (`neon login`, then `neon env pull` writes the owner's connection strings to `.env.local`, which git ignores). To set it up again: `psql "$DATABASE_URL_UNPOOLED" -v client_password=… -f db/shares.sql`, then put that password in `SHARES_DB` in `vault.js`.
- `npm test` (Node 22) runs the crawler against a fake Instagram, plus the share-link format, friend groups and layout.
- Endpoints used (web app id `936619743392459`): `/api/v1/friendships/{pk}/followers/` and `/api/v1/friendships/{pk}/mutual_followers/`, paginated with `max_id` / `next_max_id`.

| file | what it does |
|---|---|
| `extension/background.js` | owns the crawl: pacing, cooldowns, saved state; requests run inside an instagram.com tab |
| `extension/lib/crawler.js` | one crawl step at a time, no `chrome.*` calls, so it is testable; also the time-left estimate |
| `extension/lib/graphCanvas.js` | draws the graph on one `<canvas>`; snapshots during gestures |
| `extension/lib/forceLayout.js` | force layout on typed arrays (d3-force's forces at ~2.5x the speed), run in `layoutWorker.js` |
| `extension/lib/layout.js` | caches finished layouts in `localStorage` per graph; bump `LAYOUT_VERSION` when the layout changes |
| `extension/lib/groups.js` | friend groups by modularity (Louvain) |
| `extension/lib/groupNames.js` | keeps each friend-group name on its group across crawls |
| `extension/lib/merge.js` | combines two graphs and tells whose circle each person is in |
| `extension/lib/vault.js` | full shares: packs names and photos, encrypts (AES-GCM), stores and reads them through Neon's HTTP SQL endpoint |
| `db/shares.sql` | the share storage: table, the two functions, the public role allowed to call only those |
| `extension/lib/share.js` | packs the graph and view state into the link: `#g=…&p=…&c=…&v=…&n=…&m=…` |
| `extension/viewer.html`, `viewer.js` | the page: panel, search, groups key, themes, link state |

### Credits

- [D3.js v4 Force Directed Graph with Labels](https://gist.github.com/heybignick/3faf257bbbbc7743bb72310d03b86ee8), where this started; d3 v4 still handles zoom and pan.
