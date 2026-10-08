import { useEffect } from 'react';
import { drawGraph } from '@/scripts/graphVisualizer';

type GraphProps = {
  setGraphLoaded: (loaded: boolean) => void;
};

export const Graph = ({ setGraphLoaded }: GraphProps) => {
  useEffect(() => {
    const graphData = (window as any).__graphData;
    if (!graphData || !graphData.nodes || !graphData.links) {
      return;
    }

    const renderGraph = () => {
      drawGraph(graphData);
    };

    if (!(window as any).d3) {
      const script = document.createElement('script');
      script.src = 'https://d3js.org/d3.v4.min.js';
      script.onload = renderGraph;
      script.onerror = () => {
        console.error('Failed to load D3 from CDN');
      };
      document.head.appendChild(script);
      return;
    }

    renderGraph();
  }, []);

  return (
    <div className='w-full h-full'>
      <button
        onClick={() => {
          setGraphLoaded(false);
        }}
      >
        Go back
      </button>
      <svg className='w-full h-full'></svg>
    </div>
  );
};
