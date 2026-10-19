'use strict';

const statusEl = document.getElementById('status');
const actionsEl = document.getElementById('actions');
const copyBtn = document.getElementById('copy');
const clearBtn = document.getElementById('clear');

if (matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.dataset.theme = 'dark';
}

let tab = null;
let highlights = [];

function send(message) {
  return chrome.tabs.sendMessage(tab.id, message);
}

function render() {
  const n = highlights.length;
  statusEl.innerHTML = n
    ? `<mark>${n} ${n === 1 ? 'highlight' : 'highlights'}</mark> in this chat.`
    : 'No highlights in this chat yet.';
  actionsEl.hidden = false;
  copyBtn.disabled = n === 0;
  clearBtn.disabled = n === 0;
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await send({ type: 'chl:list' });
    document.documentElement.dataset.theme = res.dark ? 'dark' : 'light';
    highlights = res.items || [];
    render();
  } catch {
    // No content script in this tab.
    const onClaude = tab?.url?.startsWith('https://claude.ai/');
    statusEl.textContent = onClaude
      ? 'Reload this tab to start highlighting.'
      : 'Open a chat on claude.ai to start highlighting.';
  }
}

copyBtn.addEventListener('click', async () => {
  const title = (tab.title || 'Claude chat').replace(/\s*[-|–]\s*Claude\s*$/, '');
  const lines = highlights.map((h) => `- ${h.text.replace(/\s*\n\s*/g, ' ')}`);
  const notes = `# Highlights: ${title}\n${tab.url || ''}\n\n${lines.join('\n')}\n`;
  try {
    await navigator.clipboard.writeText(notes);
    copyBtn.textContent = 'Copied ✓';
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
  setTimeout(() => { copyBtn.textContent = 'Copy all highlights'; }, 1500);
});

let confirmTimer = 0;
clearBtn.addEventListener('click', async () => {
  if (!clearBtn.dataset.confirm) {
    clearBtn.dataset.confirm = '1';
    clearBtn.textContent = 'Click again to remove all';
    confirmTimer = setTimeout(() => {
      delete clearBtn.dataset.confirm;
      clearBtn.textContent = 'Remove all highlights';
    }, 3000);
    return;
  }
  clearTimeout(confirmTimer);
  delete clearBtn.dataset.confirm;
  clearBtn.textContent = 'Remove all highlights';
  try {
    await send({ type: 'chl:clear' });
    highlights = [];
    render();
  } catch {
    statusEl.textContent = 'Could not reach the page. Reload the tab and try again.';
  }
});

init();
