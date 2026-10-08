import { useEffect } from 'react';
import { drawGraph } from '@/scripts/graphVisualizer';

type GraphProps = {
  setGraphLoaded: (loaded: boolean) => void;
};

export const Graph = ({ setGraphLoaded }: GraphProps) => {
  useEffect(() => {
    // Get the graph data from window (set by uploadHandler)
    const graphData = (window as any).__graphData;
    if (graphData && graphData.nodes && graphData.links) {\n      // Dynamically load D3 if not already loaded\n      if (!(window as any).d3) {\n        const script = document.createElement('script');\n        script.src = 'https://d3js.org/d3.v4.min.js';\n        script.onload = () => {\n          drawGraph(graphData);\n        };\n        document.head.appendChild(script);\n      } else {\n        drawGraph(graphData);\n      }\n    }\n  }, []);\n\n  return (\n    <div className='w-full h-full'>\n      <button\n        onClick={() => {\n          setGraphLoaded(false);\n        }}\n      >\n        Go back\n      </button>\n      <svg className='w-full h-full'></svg>\n    </div>\n  );\n};
