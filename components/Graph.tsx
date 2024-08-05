type GraphProps = {
  setGraphLoaded: (loaded: boolean) => void;
};
export const Graph = ({ setGraphLoaded }: GraphProps) => {
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
