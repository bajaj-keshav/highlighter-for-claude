/*
 * Claude Highlighter — content script.
 *
 * How it works:
 * - Highlights are drawn with the CSS Custom Highlight API (CSS.highlights).
 *   The script never changes Claude's DOM, so it cannot break the page.
 * - Each highlight is saved as its text plus a little text before and after it.
 *   When Claude re-renders a chat, the script finds that text again.
 * - Highlights are saved per chat URL in chrome.storage.local (on this device only).
 */
(() => {
  'use strict';

  if (window.__claudeHighlighterLoaded) return;
  window.__claudeHighlighterLoaded = true;

  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight !== 'function') {
    console.warn('[Claude Highlighter] This browser does not support the CSS Custom Highlight API.');
    return;
  }

  // ---------------------------------------------------------------------------
  // Colors. Light values sit on Claude's cream background with dark text.
  // Dark values are more transparent so the light text stays easy to read.
  // ---------------------------------------------------------------------------
  const COLORS = [
    { id: 'yellow', name: 'Yellow', light: 'rgba(255, 212, 0, 0.45)',   dark: 'rgba(250, 204, 21, 0.34)', swatch: '#FACC15' },
    { id: 'green',  name: 'Green',  light: 'rgba(74, 222, 128, 0.40)',  dark: 'rgba(74, 222, 128, 0.28)', swatch: '#4ADE80' },
    { id: 'blue',   name: 'Blue',   light: 'rgba(96, 165, 250, 0.38)',  dark: 'rgba(96, 165, 250, 0.34)', swatch: '#60A5FA' },
    { id: 'pink',   name: 'Pink',   light: 'rgba(244, 114, 182, 0.36)', dark: 'rgba(244, 114, 182, 0.32)', swatch: '#F472B6' },
  ];
  const COLOR_IDS = COLORS.map((c) => c.id);
  const CONTEXT_CHARS = 40;
  const KEY_PREFIX = 'hl:';
  const HOST_ID = 'claude-highlighter-host';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let currentPath = location.pathname;
  let items = [];            // saved records: { id, color, text, prefix, suffix, pos, created }
  const ranges = new Map();  // id -> live Range in the page
  let lastColor = 'yellow';
  let isDark = false;

  const registry = {};
  for (const c of COLORS) {
    registry[c.id] = new Highlight();
    CSS.highlights.set('chl-' + c.id, registry[c.id]);
  }

  // ---------------------------------------------------------------------------
  // Storage helpers (they fail quietly if the extension was reloaded)
  // ---------------------------------------------------------------------------
  const storage = {
    async get(key) {
      try { return (await chrome.storage.local.get(key))[key]; } catch { return undefined; }
    },
    async set(key, value) {
      try { await chrome.storage.local.set({ [key]: value }); } catch { /* extension reloaded */ }
    },
    async remove(key) {
      try { await chrome.storage.local.remove(key); } catch { /* extension reloaded */ }
    },
  };

  const storageKey = () => KEY_PREFIX + currentPath;

  function save() {
    const key = storageKey();
    if (items.length) storage.set(key, items);
    else storage.remove(key);
  }

  async function load() {
    const key = storageKey();
    const saved = await storage.get(key);
    if (key !== storageKey()) return; // the user moved to another chat meanwhile
    items = Array.isArray(saved) ? saved.filter((h) => h && h.text && COLOR_IDS.includes(h.color)) : [];
    ranges.clear();
    refresh(true);
  }

  // ---------------------------------------------------------------------------
  // Text index: all visible-ish text nodes of the page joined into one string
  // ---------------------------------------------------------------------------
  function isSkipped(el) {
    if (!el) return true;
    if (el.isContentEditable) return true;
    return !!el.closest('script, style, noscript, textarea, input, select, #' + HOST_ID);
  }

  function buildIndex() {
    const nodes = [];
    const starts = [];
    const parts = [];
    let length = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.data.length) return NodeFilter.FILTER_REJECT;
        return isSkipped(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push(n);
      starts.push(length);
      parts.push(n.data);
      length += n.data.length;
    }
    const nodeIndex = new Map(nodes.map((n, i) => [n, i]));
    return { nodes, starts, nodeIndex, text: parts.join('') };
  }

  // Convert a DOM point (container, offset) to a position in index.text.
  function pointToOffset(index, container, offset) {
    if (container.nodeType === Node.TEXT_NODE) {
      const i = index.nodeIndex.get(container);
      if (i !== undefined) return index.starts[i] + Math.min(offset, container.data.length);
    }
    // Otherwise use the first indexed text node at or after the point.
    const probe = document.createRange();
    try { probe.setStart(container, offset); } catch { return index.text.length; }
    let lo = 0;
    let hi = index.nodes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (probe.comparePoint(index.nodes[mid], 0) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo < index.nodes.length ? index.starts[lo] : index.text.length;
  }

  // Find the text node that holds a position. For an end position, prefer the
  // node that ends there; for a start position, prefer the node that starts there.
  function locate(index, pos, isEnd) {
    const { starts, nodes } = index;
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (isEnd ? starts[mid] < pos : starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    const node = nodes[lo];
    return { node, offset: Math.max(0, Math.min(pos - starts[lo], node.data.length)) };
  }

  function rangeFromOffsets(index, start, end) {
    if (!index.nodes.length || end <= start) return null;
    const a = locate(index, start, false);
    const b = locate(index, end, true);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  }

  // ---------------------------------------------------------------------------
  // Anchoring: find a saved highlight in the current page text
  // ---------------------------------------------------------------------------
  function commonSuffixLength(a, b) {
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    return n;
  }

  function commonPrefixLength(a, b) {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n;
  }

  function findOffsets(index, rec) {
    const { text } = index;
    const len = rec.text.length;
    let best = -1;
    let bestScore = -Infinity;
    let from = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const i = text.indexOf(rec.text, from);
      if (i === -1) break;
      const before = text.slice(Math.max(0, i - rec.prefix.length), i);
      const after = text.slice(i + len, i + len + rec.suffix.length);
      const score =
        commonSuffixLength(before, rec.prefix) +
        commonPrefixLength(after, rec.suffix) -
        Math.abs(i / Math.max(1, text.length) - (rec.pos || 0));
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
      from = i + 1;
    }
    return best < 0 ? null : [best, best + len];
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  function paint() {
    for (const h of Object.values(registry)) h.clear();
    for (const item of items) {
      const r = ranges.get(item.id);
      if (r && !r.collapsed) registry[item.color].add(r);
    }
  }

  function isIntact(item) {
    const r = ranges.get(item.id);
    return !!r && !r.collapsed && r.toString() === item.text;
  }

  // Check every highlight; find the broken ones again; then draw.
  function refresh(force = false) {
    if (!items.length) {
      ranges.clear();
      paint();
      return;
    }
    if (!force && items.every(isIntact)) return;
    const index = buildIndex();
    for (const item of items) {
      if (!force && isIntact(item)) continue;
      const found = findOffsets(index, item);
      const range = found && rangeFromOffsets(index, found[0], found[1]);
      if (range) ranges.set(item.id, range);
      else ranges.delete(item.id);
    }
    paint();
  }

  let refreshTimer = 0;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(false), 200);
  }

  // ---------------------------------------------------------------------------
  // Adding, recoloring and removing
  // ---------------------------------------------------------------------------
  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function addHighlight(range, color) {
    const index = buildIndex();
    let start = pointToOffset(index, range.startContainer, range.startOffset);
    let end = pointToOffset(index, range.endContainer, range.endOffset);

    // Do not highlight leading or trailing spaces and line breaks.
    while (start < end && /\s/.test(index.text[start])) start++;
    while (end > start && /\s/.test(index.text[end - 1])) end--;
    if (end <= start) return false;

    // Grow a half-selected word to the full word, like a real highlighter.
    // Stay inside one text node, so words in two different blocks never join.
    const isWordChar = (ch) => !!ch && /[\p{L}\p{N}\p{M}]/u.test(ch);
    const a = locate(index, start, false);
    const aStart = index.starts[index.nodeIndex.get(a.node)];
    while (start > aStart && isWordChar(index.text[start]) && isWordChar(index.text[start - 1])) start--;
    const b = locate(index, end, true);
    const bEnd = index.starts[index.nodeIndex.get(b.node)] + b.node.data.length;
    while (end < bEnd && isWordChar(index.text[end - 1]) && isWordChar(index.text[end])) end++;

    // Join with highlights that overlap or touch the new one, so colors never stack.
    const kept = [];
    for (const item of items) {
      const r = ranges.get(item.id);
      if (r && !r.collapsed) {
        const s = pointToOffset(index, r.startContainer, r.startOffset);
        const e = pointToOffset(index, r.endContainer, r.endOffset);
        if (s <= end && e >= start) {
          start = Math.min(start, s);
          end = Math.max(end, e);
          ranges.delete(item.id);
          continue;
        }
      }
      kept.push(item);
    }

    const newRange = rangeFromOffsets(index, start, end);
    if (!newRange) return false;
    const record = {
      id: makeId(),
      color,
      text: index.text.slice(start, end),
      prefix: index.text.slice(Math.max(0, start - CONTEXT_CHARS), start),
      suffix: index.text.slice(end, end + CONTEXT_CHARS),
      pos: start / Math.max(1, index.text.length),
      created: Date.now(),
    };
    kept.push(record);
    items = kept;
    ranges.set(record.id, newRange);
    paint();
    save();
    return true;
  }

  function recolor(id, color) {
    const item = items.find((h) => h.id === id);
    if (!item) return;
    item.color = color;
    paint();
    save();
  }

  function removeHighlight(id) {
    items = items.filter((h) => h.id !== id);
    ranges.delete(id);
    paint();
    save();
  }

  function setLastColor(color) {
    lastColor = color;
    storage.set('lastColor', color);
  }

  // ---------------------------------------------------------------------------
  // Theme: read the real page background, so it follows Claude's own setting
  // ---------------------------------------------------------------------------
  function parseRgb(value) {
    const m = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return a === 0 ? null : [r, g, b];
  }

  function luminance([r, g, b]) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function detectDark() {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      const rgb = parseRgb(getComputedStyle(el).backgroundColor);
      if (rgb) return luminance(rgb) < 0.2;
    }
    const html = document.documentElement;
    const mode = html.getAttribute('data-mode') || html.getAttribute('data-theme');
    if (mode === 'dark' || html.classList.contains('dark')) return true;
    if (mode === 'light' || html.classList.contains('light')) return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  const pageStyle = document.createElement('style');
  pageStyle.id = 'claude-highlighter-style';

  function applyTheme() {
    const dark = detectDark();
    if (dark === isDark && pageStyle.isConnected) return;
    isDark = dark;
    pageStyle.textContent = COLORS.map(
      (c) => `::highlight(chl-${c.id}) { background-color: ${dark ? c.dark : c.light}; }`
    ).join('\n');
    if (!pageStyle.isConnected) (document.head || document.documentElement).appendChild(pageStyle);
    host.dataset.theme = dark ? 'dark' : 'light';
  }

  // ---------------------------------------------------------------------------
  // Floating toolbar (in a shadow root, so Claude's CSS cannot change it)
  // ---------------------------------------------------------------------------
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        inset: 0 auto auto 0;
        width: 0;
        height: 0;
        z-index: 2147483647;
        --bg: #ffffff;
        --border: rgba(31, 30, 29, 0.14);
        --shadow: 0 6px 24px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.08);
        --icon: #3d3d3a;
        --hover: rgba(31, 30, 29, 0.07);
        --ring: #1f1e1d;
      }
      :host([data-theme="dark"]) {
        --bg: #30302e;
        --border: rgba(255, 255, 255, 0.12);
        --shadow: 0 6px 24px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.3);
        --icon: #e5e4df;
        --hover: rgba(255, 255, 255, 0.08);
        --ring: #faf9f5;
      }
      .bar {
        position: fixed;
        display: none;
        align-items: center;
        gap: 2px;
        padding: 4px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 999px;
        box-shadow: var(--shadow);
        font: 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
        user-select: none;
        -webkit-user-select: none;
        opacity: 0;
        transform: translateY(4px) scale(0.96);
        transition: opacity 120ms ease, transform 120ms ease;
      }
      .bar.open { display: flex; }
      .bar.visible { opacity: 1; transform: none; }
      button {
        all: unset;
        box-sizing: border-box;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        cursor: pointer;
      }
      button:hover { background: var(--hover); }
      button:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
      .dot {
        width: 16px;
        height: 16px;
        border-radius: 999px;
        background: var(--c);
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
        transition: transform 100ms ease;
      }
      button:hover .dot { transform: scale(1.15); }
      button.current .dot { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--ring); }
      .sep { width: 1px; height: 18px; margin: 0 3px; background: var(--border); }
      .edit-only { display: none; }
      .bar.edit .edit-only { display: grid; }
      .bar.edit .sep.edit-only { display: block; }
      svg { width: 16px; height: 16px; stroke: var(--icon); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      @media (prefers-reduced-motion: reduce) {
        .bar, .dot { transition: none; }
      }
    </style>
    <div class="bar" role="toolbar" aria-label="Highlighter">
      ${COLORS.map(
        (c) => `<button class="swatch" data-color="${c.id}" title="${c.name}" aria-label="Highlight ${c.name}"><span class="dot" style="--c:${c.swatch}"></span></button>`
      ).join('')}
      <span class="sep edit-only"></span>
      <button class="remove edit-only" title="Remove highlight" aria-label="Remove highlight">
        <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </div>
  `;
  const bar = shadow.querySelector('.bar');

  // What the toolbar acts on: a new selection, or an existing highlight.
  let toolbar = null; // { mode: 'new', range } | { mode: 'edit', id }

  function anchorRect() {
    if (!toolbar) return null;
    const range = toolbar.mode === 'new' ? toolbar.range : ranges.get(toolbar.id);
    if (!range || range.collapsed) return null;
    const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
    if (!rects.length) return null;
    if (toolbar.mode === 'edit' && toolbar.point) {
      // Put the toolbar on the line the user clicked.
      const hit = rects.find((r) => toolbar.point.y >= r.top && toolbar.point.y <= r.bottom);
      if (hit) return { top: hit.top, bottom: hit.bottom, left: toolbar.point.x, right: toolbar.point.x };
    }
    const first = rects[0];
    const last = rects[rects.length - 1];
    // Center on the first line of the selection.
    const line = rects.filter((r) => Math.abs(r.top - first.top) < 4);
    const left = Math.min(...line.map((r) => r.left));
    const right = Math.max(...line.map((r) => r.right));
    return { top: first.top, bottom: last.bottom, left, right };
  }

  function position() {
    const rect = anchorRect();
    if (!rect || rect.bottom < 0 || rect.top > innerHeight) {
      bar.style.visibility = 'hidden';
      return;
    }
    bar.style.visibility = '';
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const gap = 8;
    let top = rect.top - h - gap;
    if (top < gap) top = rect.bottom + gap;
    let left = (rect.left + rect.right) / 2 - w / 2;
    left = Math.max(gap, Math.min(left, innerWidth - w - gap));
    bar.style.top = `${Math.round(top)}px`;
    bar.style.left = `${Math.round(left)}px`;
  }

  function show(state) {
    toolbar = state;
    bar.classList.toggle('edit', state.mode === 'edit');
    const current = state.mode === 'edit' ? items.find((h) => h.id === state.id)?.color : null;
    for (const b of shadow.querySelectorAll('.swatch')) {
      b.classList.toggle('current', b.dataset.color === current);
    }
    if (!host.isConnected) document.body.appendChild(host);
    bar.classList.add('open');
    position();
    requestAnimationFrame(() => bar.classList.add('visible'));
  }

  function hide() {
    toolbar = null;
    bar.classList.remove('open', 'visible');
  }

  // Keep the selection when the user presses a toolbar button.
  bar.addEventListener('mousedown', (e) => e.preventDefault());

  bar.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || !toolbar) return;
    if (button.classList.contains('remove') && toolbar.mode === 'edit') {
      removeHighlight(toolbar.id);
    } else if (button.dataset.color) {
      const color = button.dataset.color;
      setLastColor(color);
      if (toolbar.mode === 'new') {
        addHighlight(toolbar.range, color);
        getSelection()?.removeAllRanges();
      } else {
        recolor(toolbar.id, color);
      }
    }
    hide();
  });

  // ---------------------------------------------------------------------------
  // Page events
  // ---------------------------------------------------------------------------
  function selectionRange() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!range.toString().trim()) return null;
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (isSkipped(el)) return null;
    return range.cloneRange();
  }

  function highlightAt(x, y) {
    for (let i = items.length - 1; i >= 0; i--) {
      const r = ranges.get(items[i].id);
      if (!r || r.collapsed) continue;
      for (const rect of r.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return items[i];
      }
    }
    return null;
  }

  const fromToolbar = (e) => e.composedPath().includes(host);

  document.addEventListener('mousedown', (e) => {
    if (!fromToolbar(e)) hide();
  }, true);

  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || fromToolbar(e)) return;
    // Wait one tick so the browser finishes the selection.
    setTimeout(() => {
      const range = selectionRange();
      if (range) return show({ mode: 'new', range });
      const hit = highlightAt(e.clientX, e.clientY);
      if (hit) show({ mode: 'edit', id: hit.id, point: { x: e.clientX, y: e.clientY } });
    }, 0);
  });

  // Selections made with the keyboard (Shift + arrows).
  document.addEventListener('keyup', (e) => {
    if (!e.shiftKey || !e.key.startsWith('Arrow')) return;
    const range = selectionRange();
    if (range) show({ mode: 'new', range });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toolbar) {
      hide();
      return;
    }
    // Alt+H (Option+H on Mac): highlight the selection with the last color.
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyH') {
      const range = selectionRange();
      if (!range) return;
      e.preventDefault();
      addHighlight(range, lastColor);
      getSelection()?.removeAllRanges();
      hide();
    }
  }, true);

  document.addEventListener('selectionchange', () => {
    if (toolbar?.mode === 'new' && getSelection()?.isCollapsed) hide();
  });

  let positionFrame = 0;
  const reposition = () => {
    if (!toolbar || positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      if (toolbar) position();
    });
  };
  addEventListener('scroll', reposition, { capture: true, passive: true });
  addEventListener('resize', reposition, { passive: true });

  // Claude re-renders messages often (streaming, edits, scrolling). Re-check then.
  new MutationObserver(() => {
    if (items.length) scheduleRefresh();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  // Follow Claude's light and dark mode. The background can fade between
  // colors, so check again after the fade is done.
  let themeTimers = [];
  const checkTheme = () => {
    themeTimers.forEach(clearTimeout);
    applyTheme();
    themeTimers = [150, 400, 1000].map((ms) => setTimeout(applyTheme, ms));
  };
  const themeObserver = new MutationObserver(checkTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-mode', 'data-theme'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-mode', 'data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', checkTheme);
  document.body.addEventListener('transitionend', (e) => {
    if (e.target === document.body || e.target === document.documentElement) applyTheme();
  });

  // Claude is a single-page app: watch for moves to another chat.
  setInterval(() => {
    if (location.pathname === currentPath) return;
    currentPath = location.pathname;
    hide();
    items = [];
    ranges.clear();
    paint();
    load();
  }, 400);

  // Keep other tabs with the same chat in sync.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const change = changes[storageKey()];
      if (!change) return;
      const next = change.newValue || [];
      if (JSON.stringify(next) === JSON.stringify(items)) return;
      items = next;
      ranges.clear();
      refresh(true);
    });
  } catch { /* not in an extension (test page) */ }

  // Messages from the toolbar popup.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg?.type === 'chl:list') {
        reply({
          dark: isDark,
          items: [...items]
            .sort((a, b) => (a.pos || 0) - (b.pos || 0))
            .map(({ text, color }) => ({ text, color })),
        });
      } else if (msg?.type === 'chl:clear') {
        items = [];
        ranges.clear();
        paint();
        save();
        hide();
        reply({ ok: true });
      }
    });
  } catch { /* not in an extension (test page) */ }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  applyTheme();
  storage.get('lastColor').then((c) => {
    if (COLOR_IDS.includes(c)) lastColor = c;
  });
  load();
})();
