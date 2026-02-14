# HN Status Bar

A VS Code extension that shows rotating Hacker News stories in the status bar.

## Features

- Fetches top stories from Hacker News API.
- Shows one story at a time in the status bar.
- Each story is shown for a configurable duration (default: 20 seconds).
- Status bar hides briefly between stories (default: 2 seconds), then shows the next story.
- Click current story in status bar to open it.

## Extension Settings

This extension contributes the following settings:

- `hnStatusBar.enabled`: Enable/disable the extension.
- `hnStatusBar.maxItems`: Number of top stories to fetch.
- `hnStatusBar.displaySeconds`: Seconds each story remains visible.
- `hnStatusBar.gapSeconds`: Seconds to hide between stories.
- `hnStatusBar.refreshMinutes`: How often to refresh stories from API.
- `hnStatusBar.showScore`: Include score in status text.

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch the extension host.

Command palette commands:

- `HN Status Bar: Refresh Stories`
- `HN Status Bar: Open Current Story`
