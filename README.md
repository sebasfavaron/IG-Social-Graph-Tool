## Instagram social graph

This repository attempts to document the process of generating a social graph based on personal ig socials
It's split into two parts:

1. Running the website:
   1. Use the tool you prefer to start a simple http server. A simple one if you have python installed is [SimpleHTTPServer](https://www.redhat.com/sysadmin/simple-http-server). Personally, I'm using the [simple-hot-reload-server](https://www.npmjs.com/package/simple-hot-reload-server/v/1.1.4)
2. Generating the data:
   1. From the server you just ran, you need to drag the bookmark link (Note: if you want to modify the bookmarklet see here[^1])
   2. Head to [instagram](https://www.instagram.com)
   3. Click the bookmarklet
   4. Wait 15-20 seconds until it prompts you to download the json (TODO: add example json image or gif of the process)
3. Visualizing the data:
   1. Upload the recently downloaded json file using the "Upload" button
   2. Enjoy your own personal, interactive social graph!

If you have any issues, don't hesitate contacting me. I have only tested this on a Mac using Safari so far

---

### Credits (tutorials that helped me hack this together):

- [Upload file](https://gomakethings.com/how-to-upload-and-process-a-json-file-with-vanilla-js/)
- [D3.js v4 Force Directed Graph with Labels](https://gist.github.com/heybignick/3faf257bbbbc7743bb72310d03b86ee8)
- Bookmarklet
  - [Creation](https://www.freecodecamp.org/news/what-are-bookmarklets/)
  - [Method to save json](https://stackoverflow.com/a/60377870)

[^1]: I left the [file](./bookmarklet-download-ig-data.js) in the repo to be able to be modified. A simple way of updating the bookmark after modification is selecting the whole file's text, and pasting it directly in the bookmark's address.
