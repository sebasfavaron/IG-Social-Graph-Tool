# DEPRECATED bookmarklet note

The original bookmarklet-based flow relied on a GitHub Pages script and stopped working because Instagram restricts that pattern. The browser-extension approach is a local workaround that runs directly on Instagram pages and exports the graph as JSON.

## Browser extension workaround

1. Open Chrome and go to `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select the `extension/` folder from this repository.
5. Open Instagram and sign in.
6. Open your profile page.
7. Click the extension popup and choose `Collect graph`.
8. Save the generated JSON file and upload it to the web app to visualize the graph.

This is a local-only workaround and should be considered a personal use tool, not an official Instagram integration.

---

## Original project note

The repository still contains the original bookmarklet and graph visualizer, but the recommended modern fallback is this local browser-extension flow.
