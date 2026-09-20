let interval = null;

self.onmessage = (e) => {
  if (e.data === 'start') {
    if (interval) clearInterval(interval);
    interval = setInterval(() => self.postMessage(Date.now()), 1000);
  }
  if (e.data === 'stop') {
    clearInterval(interval);
    interval = null;
  }
};
