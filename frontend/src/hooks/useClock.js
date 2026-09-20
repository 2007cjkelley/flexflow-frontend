import { useEffect, useRef } from 'react';

export function useClock(onTick) {
  const workerRef = useRef(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    const worker = new Worker('/clockWorker.js');
    workerRef.current = worker;
    worker.onmessage = (e) => onTickRef.current(e.data);
    worker.postMessage('start');
    return () => {
      worker.postMessage('stop');
      worker.terminate();
    };
  }, []);
}
