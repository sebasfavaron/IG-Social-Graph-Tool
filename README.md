## Instagram social graph

Draws who-follows-whom among the people who follow you on Instagram, as an interactive graph: your friend groups come out as coloured clusters, and clicking anyone shows who follows them, whom they follow and who follows each other.

**See it first:** open [sebasfavaron.github.io/IG-Social-Graph-Tool](https://sebasfavaron.github.io/IG-Social-Graph-Tool/): it lists the graphs friends have shared; tick one or a few to see them.

### Map your own followers (Chrome extension)

Not technical? [**The install page**](https://sebasfavaron.github.io/IG-Social-Graph-Tool/install.html) walks through it with a download button, and after installing, a welcome tab checks the icon is pinned and you're logged in, then starts. Shared graphs link there.

1. Download [`ig-social-graph.zip`](https://sebasfavaron.github.io/IG-Social-Graph-Tool/ig-social-graph.zip) (or clone this repo), open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the unzipped folder (or [`extension/`](./extension)). Keep the folder: Chrome runs the extension from it, and does not update it on its own.
2. Log in to [instagram.com](https://www.instagram.com) in that browser.
3. Click the extension icon → **Start**. It lists your followers, then asks Instagram, for each of them, which accounts you follow also follow them.
4. Leave it running. The popup shows progress and the time left, measured from the pace so far (Instagram's pauses included); the icon badge shows the percentage. You can close the popup, pause and resume, or restart the browser: progress is saved.
5. **View graph** opens the graph in a new tab. **Publish & copy link** makes your graph public (it asks first, in warning colours) and copies a short link anyone can open, no extension needed, with names and photos included.

The crawl also keeps everyone's real name and profile photo, which come with the same lists at no extra request. A crawl made before that can get them with **Get names & photos** in the popup: your followers list again, about one request per 50 followers.

Requests go from an instagram.com tab with your own session, and the data stays in the extension's local storage. Nothing is sent anywhere else.

### Reading the graph

- **Friend groups** are found from who-follows-whom alone and coloured. You are left out of the grouping, since you connect to everyone. The key in the corner lists them: point at a group to highlight its people and the lines between them, click its name to rename it. Names travel in the share link.
- **Dot size** follows the number of connections, and dots shrink as you zoom out so they never pile up. Names never overlap: the most connected people are labelled first.
- **Photos** take the place of the dots once you zoom in far enough to tell faces apart; the friend-group colour stays as a ring.
- **Search** finds people by username or real name, accents ignored ("jose" finds José).
- **Click someone**, or find them with search (`/`), to open their panel: who follows them, whom they follow and who follows each other, as lists you can click through, plus their photo, real name and a link to their Instagram. When there are more than 15 people, a filter box narrows the lists. Selecting someone zooms to fit most of their people around them. Point at a list to show only those lines; click its heading to keep it. `Esc` clears.
- **Directions** are orange and blue, which stay distinguishable with red-green colour blindness; "follow each other" is a heavier neutral line.
- **Light and dark** themes follow your system; the ☾ / ☀ button overrides it.
- **Loners**, accounts with a single connection (usually shops and meme pages that only follow you), stay hidden until you select the person they're linked to, so each group in the panel shows everyone its count includes.

**On phones** the panel is a bottom sheet with one tab per group (a tab also shows only that group's lines) and a handle that folds it down to the name. The groups key starts folded. Panning and pinching move a snapshot of the graph and redraw sharp when you let go, so they stay smooth with 10 000 lines.

**Keyboard and screen readers:** every control is a real button or field with a visible focus ring; each selection is announced ("Selected @x. 10 follow @x…"); "reduce motion" skips the pan animation.

### Share links

**Publish & copy link** ("Publicar y copiar link") first shows what goes public and asks; then it puts your crawl in a small shared database ([Neon](https://neon.com) Postgres), with everyone's real name and photo, and copies a link that is just your username plus what you are looking at: `#o=sebas.favaron&p=ana&n=school,work`. Who is selected, the zoom and your friend-group names ride in the link; the graph, names and photos come from the database. Once everything on screen is public, the button just says **Copy link** and uploads nothing.

The database keeps one graph per person and one row per Instagram account. Someone who is in two friends' graphs is stored once, and sharing again replaces your graph instead of adding a copy (sharing twice without changes uploads nothing). The link always opens your latest share.

**Only the browser that published a graph can replace or unpublish it.** The first publish makes a random key that stays in that browser (the database keeps only its hash); **Unpublish** on your own graph deletes it, and the names and photos only it had, from the database. Clearing the browser's data for the extension loses the key, and then only whoever runs the database can free the graph.

**Publish yours to see the others.** Graphs are seen among people who published their own. Two graphs are linked when their owners follow each other (one way or both); your network is every graph you can reach through such links, friends of friends included, and that is what the home list, links and Explore show you. Each side of a link is vouched for by the other person's own crawl, so a made-up account links to nobody and only ever sees itself. Before you publish, a link to someone's graph shows who published it and how many people it holds, and how to get in.

The extension keeps your key, so the site learns who you are from a link the extension opens (**See the network on the web** in the popup, or **Explore data**); after that the site remembers.

**What is still public.** The database password is in the page's code, so the rules live in the database functions ([`db/graphs.sql`](./db/graphs.sql)). Without accounts, anyone can publish under a username nobody has claimed yet; a real name and profile photo can be read by a network that lists that username (Instagram shows those to anyone anyway), but who follows whom stays inside its network, and nobody outside can rename anyone. Uploads stop at 2 MB per graph, 60 graphs an hour and 400 MB in total, which keeps strangers from filling the free tier.

### Combine two people's graphs

**Combine with friends…** lists everyone who has shared a graph, with their photo, how many people their graph holds and when they shared it. Tick up to five and they are drawn as one graph; nothing new is uploaded. The same list is the site's home page. The key switches from friend groups to circles: one colour for the people only each of you knows, and one for the people in more than one circle (with two people, "in both"). Click a circle to keep it highlighted. The combined link lists the usernames (`#o=you&m=friend,another`), and each name in the title opens that person's graph alone.

### Explore the data

**Explore data** (on any shared graph, or [`explore.html`](https://sebasfavaron.github.io/IG-Social-Graph-Tool/explore.html)) loads one or more shared graphs into a SQLite database inside the page and lets you ask them anything in SQL: who is in more than one circle, whether two people follow each other, every route between two people that avoids a third. It starts with example questions, and usernames in the results open that person in the graph. The tables are `owners`, `people`, `follows`, `circles` and an `edges` view.

Each crawl only sees follows among its owner's own people, so a follow between two people who share no loaded circle is not in the data: "none found" there means "can't see".

It downloads about 300 KB for SQLite ([sql.js](https://sql.js.org) from cdnjs) plus ~35 KB of graphs and ~70 KB of names for three people, and no photos. The extension cannot load scripts from other sites, so the button always opens the page on the site.

### Older links

Links made before shares were stored carry the whole graph after `#g=` (~10 000 characters, usernames only), in a format built for these graphs: each pair of people is stored once with its direction, your own links are two bits per person, and people are numbered friend group by friend group so neighbours get nearby numbers. They still open, as do links to GitHub gists from a short while when shares went there.

Links from before the shared database (`#s=…&k=…`) were encrypted, and only the link holds the key. Opening one copies its graph, names and photos into the database (a combined one is split back into each person's graph), replacing a stored graph only when the link is newer, and the address becomes the short `#o=` link.

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

- **Bump `version` in `extension/manifest.json` when shipping a change to the extension.** The site publishes it as `version.json`; a popup whose version is older shows a download button for the new zip. Without the bump nobody gets told.
- After editing, hit the reload icon on the extension's card in `chrome://extensions`. Chrome keeps the old background worker running until then, while the popup is read fresh each time.
- The share storage is the Neon project linked in `neon.ts` (`neon login`, then `neon env pull` writes the owner's connection strings to `.env.local`, which git ignores). To set it up again: `psql "$DATABASE_URL_UNPOOLED" -v client_password=… -f db/shares.sql`, then `psql "$DATABASE_URL_UNPOOLED" -f db/graphs.sql`, then put that password in `SHARES_DB` in `store.js`.
- A preview of the viewer that is hidden (a background tab) never finishes opening a link: the view is restored after the first animation frame, which hidden pages do not run.
- **Loading order of a shared graph:** the graphs first (~35 KB for three people), drawn while the layout settles; then names (~70 KB); then photos, which are ~98% of the bytes (12.5 MB for three people), most connected people first, 100 per request and 6 requests at a time. All photo requests at once share the bandwidth and on a slow connection all land at the very end, which is why they are capped.
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
| `extension/explore.html`, `explore.js` | SQL over shared graphs (sql.js), site only |
| `extension/lib/i18n.js` | the viewer's words in Spanish (default) and English; static text in viewer.html carries `data-i18n` keys |
| `extension/lib/store.js` | shared database: saves and reads graphs by owner and people by username through Neon's HTTP SQL endpoint |
| `extension/lib/vault.js` | older encrypted shares: reads them so the viewer can copy them over |
| `db/shares.sql` | the share storage: table, the two functions, the public role allowed to call only those |
| `extension/lib/share.js` | packs the graph and view state into the link: `#g=…&p=…&c=…&v=…&n=…&m=…` |
| `extension/viewer.html`, `viewer.js` | the page: panel, search, groups key, themes, link state |
| `extension/install.html` | site only: step-by-step install for non-technical people; phones and non-Chromium browsers get told to switch |
| `extension/welcome.html`, `welcome.js` | opens on first install: pin the icon, log in, Start, progress |

### Credits

- [D3.js v4 Force Directed Graph with Labels](https://gist.github.com/heybignick/3faf257bbbbc7743bb72310d03b86ee8), where this started; d3 v4 still handles zoom and pan.
