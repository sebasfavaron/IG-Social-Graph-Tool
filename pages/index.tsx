import { handleSubmit } from '@/scripts/uploadHandler';
import Head from 'next/head';

export default function Home() {
  return (
    <div className='w-full h-full p-2'>
      <Head>
        <meta charSet='utf-8' />
        <title>Force-Directed Graph</title>
        <script src='https://d3js.org/d3.v4.min.js'></script>
      </Head>

      <p id='bookmarklet'>
        <a href="javascript:(()=>{const%20script=document.createElement('script');script.src='https://sebasfavaron.github.io/IG-Social-Graph-Tool/scripts/bookmarklet-download-ig-data.js';document.body.appendChild(script);})();">
          IG Data Downloader
        </a>
        <span>
          - Drag me to your bookmarks, then click me while on instagram to start
          the data download process
        </span>
      </p>
      <div id='file-input-container' className='file-input-container'>
        <input
          id='file'
          onChange={handleSubmit}
          type='file'
          accept='.json'
          className='big-input'
        />
        <label className='file-input-label'>Drag file here</label>
      </div>
      <svg></svg>
    </div>
  );
}
