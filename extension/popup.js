const setStatus = (message, isError = false) => {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', isError);
};

const runCollection = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) {
    setStatus('No active Instagram tab found.', true);
    return;
  }

  try {
    setStatus('Collecting graph...');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'collectGraph' });

    if (!response || !response.ok) {
      throw new Error(response?.error || 'Unable to collect graph.');
    }

    const blob = new Blob([JSON.stringify(response.data, null, 2)], {
      type: 'application/json',
    });

    const fileUrl = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url: fileUrl,
      filename: response.filename || 'ig-social-circle.json',
      saveAs: true,
    });

    setStatus('Graph downloaded.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to collect graph.', true);
  }
};

const openInstagramTab = () => {
  chrome.tabs.create({ url: 'https://www.instagram.com' });
};

document.getElementById('collect')?.addEventListener('click', runCollection);
document.getElementById('open-instagram')?.addEventListener('click', openInstagramTab);
