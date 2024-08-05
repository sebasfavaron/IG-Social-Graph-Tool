import Head from 'next/head';
import { useState } from 'react';
import { HomePage } from '../components/Homepage';
import { Graph } from '../components/Graph';

export default function Home() {
  const [graphLoaded, setGraphLoaded] = useState(false);

  return (
    <div className='w-full h-full p-2'>
      <Head>
        <meta charSet='utf-8' />
        <title>Force-Directed Graph</title>
        <script src='https://d3js.org/d3.v4.min.js'></script>
      </Head>

      {!graphLoaded && <HomePage setGraphLoaded={setGraphLoaded} />}
      {graphLoaded && <Graph setGraphLoaded={setGraphLoaded} />}
    </div>
  );
}
