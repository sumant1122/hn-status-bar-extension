import * as https from "https";
import * as vscode from "vscode";

type HNItem = {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  score?: number;
  by?: string;
};

type Config = {
  enabled: boolean;
  maxItems: number;
  displaySeconds: number;
  gapSeconds: number;
  refreshMinutes: number;
  showScore: boolean;
};

const TOP_STORIES_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";

let statusBarItem: vscode.StatusBarItem;
let stories: HNItem[] = [];
let currentIndex = -1;
let currentStory: HNItem | undefined;

let rotateTimeout: NodeJS.Timeout | undefined;
let gapTimeout: NodeJS.Timeout | undefined;
let refreshInterval: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "hnStatusBar.openCurrent";
  statusBarItem.text = "$(rss) HN: loading...";
  statusBarItem.tooltip = "Loading Hacker News stories";

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand("hnStatusBar.refresh", async () => {
      await refreshStories(true);
    }),
    vscode.commands.registerCommand("hnStatusBar.openCurrent", async () => {
      if (!currentStory) {
        return;
      }

      const target = currentStory.url
        ? currentStory.url
        : `https://news.ycombinator.com/item?id=${currentStory.id}`;

      await vscode.env.openExternal(vscode.Uri.parse(target));
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration("hnStatusBar")) {
        return;
      }

      applyEnabledState();
      scheduleRefresh();
      restartRotation();

      if (getConfig().enabled) {
        await refreshStories(false);
      }
    })
  );

  applyEnabledState();
  scheduleRefresh();
  void refreshStories(false);
}

export function deactivate(): void {
  clearTimers();
}

function getConfig(): Config {
  const cfg = vscode.workspace.getConfiguration("hnStatusBar");
  return {
    enabled: cfg.get<boolean>("enabled", true),
    maxItems: cfg.get<number>("maxItems", 30),
    displaySeconds: cfg.get<number>("displaySeconds", 20),
    gapSeconds: cfg.get<number>("gapSeconds", 2),
    refreshMinutes: cfg.get<number>("refreshMinutes", 15),
    showScore: cfg.get<boolean>("showScore", true)
  };
}

function applyEnabledState(): void {
  if (getConfig().enabled) {
    statusBarItem.show();
    return;
  }

  clearTimers();
  statusBarItem.hide();
}

function clearTimers(): void {
  clearRotationTimers();

  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }
}

function clearRotationTimers(): void {
  if (rotateTimeout) {
    clearTimeout(rotateTimeout);
    rotateTimeout = undefined;
  }

  if (gapTimeout) {
    clearTimeout(gapTimeout);
    gapTimeout = undefined;
  }
}

function restartRotation(): void {
  clearRotationTimers();

  if (stories.length > 0 && getConfig().enabled) {
    showNextStory();
  }
}

function scheduleRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }

  const { enabled, refreshMinutes } = getConfig();
  if (!enabled) {
    return;
  }

  refreshInterval = setInterval(() => {
    void refreshStories(false);
  }, Math.max(1, refreshMinutes) * 60_000);
}

async function refreshStories(showErrors: boolean): Promise<void> {
  if (!getConfig().enabled) {
    return;
  }

  clearRotationTimers();
  statusBarItem.text = "$(rss) HN: loading...";
  statusBarItem.tooltip = "Refreshing Hacker News stories";
  statusBarItem.show();

  try {
    const freshStories = await fetchTopStories();
    stories = freshStories;
    currentIndex = -1;

    if (stories.length === 0) {
      statusBarItem.text = "$(warning) HN: no stories";
      statusBarItem.tooltip = "No stories returned from Hacker News API";
      statusBarItem.command = "hnStatusBar.refresh";
      statusBarItem.show();
      return;
    }

    statusBarItem.command = "hnStatusBar.openCurrent";
    showNextStory();
  } catch (error) {
    statusBarItem.text = "$(warning) HN: fetch failed";
    statusBarItem.tooltip = "Click to refresh";
    statusBarItem.command = "hnStatusBar.refresh";
    statusBarItem.show();

    if (showErrors) {
      const message = error instanceof Error ? error.message : "Unknown error";
      void vscode.window.showErrorMessage(`HN Status Bar: ${message}`);
    }
  }
}

function showNextStory(): void {
  if (!getConfig().enabled) {
    return;
  }

  if (stories.length === 0) {
    statusBarItem.text = "$(warning) HN: no stories";
    statusBarItem.tooltip = "No stories available";
    statusBarItem.show();
    return;
  }

  const { displaySeconds, gapSeconds, showScore } = getConfig();

  currentIndex = (currentIndex + 1) % stories.length;
  currentStory = stories[currentIndex];

  const scoreText = showScore && typeof currentStory.score === "number" ? ` (${currentStory.score})` : "";
  statusBarItem.text = `$(rss) ${currentStory.title ?? "Untitled"}${scoreText}`;
  statusBarItem.tooltip = currentStory.url
    ? `${currentStory.title ?? "Untitled"}\n${currentStory.url}`
    : `${currentStory.title ?? "Untitled"}\nnews.ycombinator.com/item?id=${currentStory.id}`;
  statusBarItem.command = "hnStatusBar.openCurrent";
  statusBarItem.show();

  rotateTimeout = setTimeout(() => {
    statusBarItem.hide();
    gapTimeout = setTimeout(() => {
      showNextStory();
    }, Math.max(0, gapSeconds) * 1000);
  }, Math.max(1, displaySeconds) * 1000);
}

async function fetchTopStories(): Promise<HNItem[]> {
  const { maxItems } = getConfig();

  const ids = await fetchJson<number[]>(TOP_STORIES_URL);
  const targetIds = ids.slice(0, Math.max(1, maxItems));

  const items = await Promise.all(
    targetIds.map((id) => fetchJson<HNItem>(`${ITEM_URL}/${id}.json`).catch(() => undefined))
  );

  return items.filter((item): item is HNItem => {
    return !!item && item.type === "story" && typeof item.title === "string";
  });
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Request failed with status ${statusCode} for ${url}`));
          response.resume();
          return;
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(new Error(`Failed to parse JSON from ${url}`));
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}
