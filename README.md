## Instagram social network

This repository attempts to document the process of generating a social graph based on personal ig socials
It's split into two parts:

1. [bookmarklet](./bookmarklet-download-ig-data.js) that is supposed to be manually copied into the address of a bookmark (see [how_to_create_a_bookmarklet](https://www.freecodecamp.org/news/what-are-bookmarklets/)) or use this [bookmarklet_maker](https://caiorss.github.io/bookmarklet-maker/)
   - Once the bookmarklet is created, simply head to [instagram](https://www.instagram.com), click the bookmarklet and wait 15-20 seconds until it prompts you to download the json (TODO: add example json image)
2. Vanilla website that renders the downloaded json file with the social graph data. To run:
   1. Use the tool you prefer to start a simple http server. A simple one if you have python installed is [SimpleHTTPServer](https://www.redhat.com/sysadmin/simple-http-server)
   2. Upload the recently downloaded file using the "Upload" button
   3. If everything went ok, enjoy your own personal, interactive social graph!

---

### Credits (tutorials that helped me hack this together):

- [Upload file](https://gomakethings.com/how-to-upload-and-process-a-json-file-with-vanilla-js/)
- [D3.js v4 Force Directed Graph with Labels](https://gist.github.com/heybignick/3faf257bbbbc7743bb72310d03b86ee8)
- Bookmarklet
  - [Creation](https://www.freecodecamp.org/news/what-are-bookmarklets/)
  - [Method to save json](https://stackoverflow.com/a/60377870)
