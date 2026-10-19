# Claude Highlighter

Highlight text in your Claude chats, like a highlighter pen on paper.

Made for studying: read Claude's answer, mark the important parts, and come back to them later.

| Light mode | Dark mode |
| --- | --- |
| ![Highlights in light mode](docs/preview-light.jpg) | ![Highlights in dark mode](docs/preview-dark.jpg) |

## How to use

1. Select text in a chat.
2. Click a color.

That is all. To change or remove a highlight, click it.

| Action | How |
| --- | --- |
| Highlight | Select text, then click a color |
| Quick highlight | Select text, then press `Alt`+`H` (`⌥`+`H` on Mac). It uses your last color. |
| Change the color | Click the highlight, then click a new color |
| Remove | Click the highlight, then click the trash icon |
| Copy all highlights as notes | Click the extension icon, then **Copy all highlights** |

## Features

- **Four colors:** yellow, green, blue and pink.
- **Light and dark mode:** colors change automatically with Claude's theme. Text stays easy to read in both.
- **Saved:** highlights stay after you reload the page or come back to the chat later.
- **Whole words:** if you select half of a word, the highlight grows to the full word.
- **No overlap mess:** a new highlight that touches an old one joins it.
- **Copy as notes:** copy all highlights of a chat as a Markdown list for your study notes.
- **Safe:** the extension does not change Claude's page structure. It uses the browser's [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API), so Claude keeps working normally.
- **Private:** highlights are saved only in your browser. The extension sends nothing over the network.

## Install

The extension works in Chrome, Edge, Brave, Arc and other Chromium browsers (version 105 or later).

1. Download this repository: click **Code → Download ZIP**, then unzip it.
2. Open `chrome://extensions` in your browser.
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked**.
5. Select the `extension` folder.
6. Open [claude.ai](https://claude.ai). If a chat was already open, reload the tab.

Tip: pin the extension (puzzle icon → pin) to see the highlight count and the copy button.

## Limits

- It works on **claude.ai in the browser**. The Claude desktop and mobile apps do not support extensions.
- It does not work inside artifacts. Artifacts run in a separate frame.
- Highlights are saved per chat. If you edit a message or Claude writes a new answer, highlights on the old text can disappear.
- Highlights stay on one browser. They do not sync between computers.

## Try it without Claude

The `demo` folder has a test page that looks like a Claude chat. It has a light and dark mode switch.

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765/demo/>.

## Project structure

```
extension/
  manifest.json   Extension settings (Manifest V3)
  content.js      The highlighter (runs on claude.ai)
  popup.html/js   The toolbar popup: count, copy, remove all
  icons/          Extension icons
scripts/
  make_icons.py   Draws the icons (no extra packages needed)
demo/
  index.html      Local test page
```

## Contributing

Issues and pull requests are welcome. Please test light and dark mode on the demo page before you send a change.

## License

[MIT](LICENSE)

Claude Highlighter is a community project. It is not made by or affiliated with Anthropic.
