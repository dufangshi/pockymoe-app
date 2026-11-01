import { app, dialog } from 'electron';
import updater from 'electron-updater';
const { autoUpdater } = updater;
export function configureUpdates(): void {
  autoUpdater.setFeedURL({ provider: 'github', owner: 'dufangshi', repo: 'pockymoe-app' });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', () => { /* Offline checks must not interrupt work. */ });
  autoUpdater.on('update-available', async info => {
    const answer = await dialog.showMessageBox({ type: 'info', title: 'Pockymoe 有更新', message: `版本 ${info.version} 已可下载`, buttons: ['下载更新', '稍后'], cancelId: 1 });
    if (answer.response === 0) void autoUpdater.downloadUpdate().catch(() => undefined);
  });
  autoUpdater.on('update-downloaded', async () => {
    const answer = await dialog.showMessageBox({ type: 'info', title: '更新已就绪', message: '退出时会自动安装更新。', buttons: ['现在重启', '稍后'], cancelId: 1 });
    if (answer.response === 0) autoUpdater.quitAndInstall();
  });
  if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => undefined);
}
export async function checkUpdate(): Promise<void> {
  if (!app.isPackaged) { await dialog.showMessageBox({ message: '开发版本不检查更新', detail: '安装打包版本后可从 GitHub Releases 获取更新。' }); return; }
  await autoUpdater.checkForUpdates();
}
