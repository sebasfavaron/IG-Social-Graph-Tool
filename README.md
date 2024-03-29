# DEPRECATED: this tool does not work anymore because Instagram now blocks scripts coming from github.io
## Instagram social graph

### Note: To run from the online version just head to https://ig-social-graph.netlify.app/ and follow the instructions

Generate a social graph based on your ig socials (the local way)
It's split into two parts:

2. Generating the data:
   1. From the server you just ran, you need to drag the bookmark link (Note: if you want to modify the bookmarklet see here[^1])
   2. Head to [instagram](https://www.instagram.com)
   3. Click the bookmarklet
   4. (Optional) If you have a previous incomplete json, upload that on the box that appears. The script will continue where it left. If not, click close.
   5. Wait until it finishes and downloads the json. You can use the console to see the progress
   6. (Optional) If you want to remove accounts only you follow from the data run [prune](./pruneSocialGraph.js) with the filename. It will return a new file without the lone followings (this helps remove influencers or ig shops and makes the graph cleaner)
3. Visualizing the data:
   1. Enter the [website](https://ig-social-graph.netlify.app/). Alternatively, you can run the website locally. Use the tool you prefer to start a simple http server. A simple one if you have python installed is [SimpleHTTPServer](https://www.redhat.com/sysadmin/simple-http-server). Personally, I'm using the [simple-hot-reload-server](https://www.npmjs.com/package/simple-hot-reload-server/v/1.1.4)
   2. Upload the recently downloaded json file using the "Upload" button
   3. Enjoy your own personal, interactive social graph!

If you have any issues, don't hesitate contacting me. I have only tested this on a Mac using Safari and Chrome so far

---

### Debugging

- If you get an error while downloading the data, it's probable you have reached IG's rate limit (I think it allows 200 requests per hour, among other possible daily limits). This means you should try again in a few hours. DO NOT keep trying if this happens as it will only increase your wait time
- If you see the graph stuck in the top-right corner, the data is not well formated. Try running [addMissingNodes](./addMissingNodes.js) to fix it. Refresh and load the json file again

### Credits (tutorials that helped me hack this together):

- [Upload file](https://gomakethings.com/how-to-upload-and-process-a-json-file-with-vanilla-js/)
- [D3.js v4 Force Directed Graph with Labels](https://gist.github.com/heybignick/3faf257bbbbc7743bb72310d03b86ee8)
- Bookmarklet
  - [Creation](https://www.freecodecamp.org/news/what-are-bookmarklets/)
  - [Method to save json](https://stackoverflow.com/a/60377870)

[^1]: I left the [file](./bookmarklet-download-ig-data.js) in the repo to be able to be modified. A simple way of updating the bookmark after modification is selecting the whole file's text, and pasting it directly in the bookmark's address.
