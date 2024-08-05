import { manualJsonLoad, handleSubmit } from '@/scripts/uploadHandler';

type HomePageProps = {
  setGraphLoaded: (loaded: boolean) => void;
};
export const HomePage = ({ setGraphLoaded }: HomePageProps) => {
  return (
    <div>
      <p id='bookmarklet'>
        <a href="javascript:(()=>{const%20script=document.createElement('script');script.src='https://sebasfavaron.github.io/IG-Social-Graph-Tool/scripts/bookmarklet-download-ig-data.js';document.body.appendChild(script);})();">
          IG Data Downloader
        </a>
        <span>
          - Drag me to your bookmarks, then click me while on instagram to start
          the data download process
        </span>
      </p>
      <button
        onClick={() => {
          setGraphLoaded(true);
          manualJsonLoad();
        }}
      >
        Load example graph
      </button>
      <div id='file-input-container' className='file-input-container'>
        <input
          id='file'
          onChange={() => {
            setGraphLoaded(true);
            handleSubmit();
          }}
          type='file'
          accept='.json'
          className='big-input'
        />
        <label className='file-input-label'>Drag file here</label>
      </div>
    </div>
  );
};
