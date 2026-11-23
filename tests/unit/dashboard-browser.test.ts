import { expect, test } from '@playwright/test';
import { browserCommand } from '../../src/scripts/dashboard/browser';

const URL = 'http://localhost:4400';
const WINDOWS = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };

test.describe('The browser the dashboard opens in', () => {
  test('no choice: the computer\'s default browser', () => {
    expect(browserCommand(URL, undefined, 'win32', WINDOWS)).toEqual({ command: 'rundll32', args: ['url.dll,FileProtocolHandler', URL] });
    expect(browserCommand(URL, '  ', 'darwin', {})).toEqual({ command: 'open', args: [URL] });
  });

  test('Brave on Windows is found where it installs itself (per user, or for everyone)', () => {
    const perUser = 'C:\\Users\\me\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
    expect(browserCommand(URL, 'Brave', 'win32', WINDOWS, (file) => file === perUser)).toEqual({ command: perUser, args: [URL] });
    const everyone = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
    expect(browserCommand(URL, 'brave', 'win32', WINDOWS, (file) => file === everyone)).toEqual({ command: everyone, args: [URL] });
  });

  test('a browser that is not there, or an unknown name, opens the default browser and says why', () => {
    const missing = browserCommand(URL, 'brave', 'win32', WINDOWS, () => false);
    expect(missing.command).toBe('rundll32');
    expect(missing.note).toMatch(/not installed/);
    expect(browserCommand(URL, 'netscape', 'win32', WINDOWS, () => true).note).toMatch(/not one of/);
  });

  test('a full path is used as it is; on a Mac the app is opened by its name', () => {
    expect(browserCommand(URL, '"D:\\Apps\\brave.exe"', 'win32', WINDOWS, () => true)).toEqual({ command: 'D:\\Apps\\brave.exe', args: [URL] });
    expect(browserCommand(URL, 'brave', 'darwin', {})).toEqual({ command: 'open', args: ['-a', 'Brave Browser', URL] });
  });
});
