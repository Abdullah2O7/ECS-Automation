import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Which browser the dashboard opens in: the computer's default, or the one the person names in their own .env
 * (DASHBOARD_BROWSER=brave, chrome, edge or firefox - or the full path of a browser's .exe). Only where the dashboard is
 * shown; the tests themselves run in Playwright's own Chrome.
 */

export type BrowserCommand = { command: string; args: string[]; note?: string };

/** Where the browsers install themselves on Windows, under %LOCALAPPDATA%, %ProgramFiles% or %ProgramFiles(x86)%. */
const WINDOWS_PATHS: Record<string, string> = {
  brave: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  chrome: 'Google\\Chrome\\Application\\chrome.exe',
  edge: 'Microsoft\\Edge\\Application\\msedge.exe',
  firefox: 'Mozilla Firefox\\firefox.exe',
};

/** The names of the browsers on a Mac (`open -a`) and on Linux. */
const MAC_NAMES: Record<string, string> = { brave: 'Brave Browser', chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Firefox' };
const LINUX_NAMES: Record<string, string> = { brave: 'brave-browser', chrome: 'google-chrome', edge: 'microsoft-edge', firefox: 'firefox' };

const systemDefault = (url: string, platform: NodeJS.Platform): BrowserCommand =>
  platform === 'win32' ? { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] } : platform === 'darwin' ? { command: 'open', args: [url] } : { command: 'xdg-open', args: [url] };

/** The command that opens `url` in the chosen browser; the default browser (with a note why) when it cannot be found. */
export const browserCommand = (
  url: string,
  choice: string | undefined,
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (file: string) => boolean = existsSync,
): BrowserCommand => {
  const wanted = (choice ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!wanted) {
    return systemDefault(url, platform);
  }
  const name = wanted.toLowerCase();
  if (/\.exe$/i.test(wanted) || wanted.includes('/') || wanted.includes('\\')) {
    return exists(wanted) ? { command: wanted, args: [url] } : { ...systemDefault(url, platform), note: `DASHBOARD_BROWSER: "${wanted}" was not found - opening the default browser` };
  }
  if (platform === 'win32' && WINDOWS_PATHS[name]) {
    const roots = [env.LOCALAPPDATA, env.ProgramFiles ?? env.PROGRAMFILES, env['ProgramFiles(x86)']].filter((root): root is string => Boolean(root));
    const found = roots.map((root) => path.win32.join(root, WINDOWS_PATHS[name])).find((file) => exists(file));
    return found ? { command: found, args: [url] } : { ...systemDefault(url, platform), note: `DASHBOARD_BROWSER: ${wanted} is not installed where it usually is - opening the default browser (or give the full path of its .exe)` };
  }
  if (platform === 'darwin' && MAC_NAMES[name]) {
    return { command: 'open', args: ['-a', MAC_NAMES[name], url] };
  }
  if (platform !== 'win32' && platform !== 'darwin' && LINUX_NAMES[name]) {
    return { command: LINUX_NAMES[name], args: [url] };
  }
  return { ...systemDefault(url, platform), note: `DASHBOARD_BROWSER: "${wanted}" is not one of brave, chrome, edge, firefox or a path to a browser - opening the default browser` };
};

/** The person's choice: the dashboard's environment first, then their .env. */
export const chosenBrowser = (file = '.env'): string | undefined =>
  process.env.DASHBOARD_BROWSER ?? (existsSync(file) ? dotenv.parse(readFileSync(file)).DASHBOARD_BROWSER : undefined);
