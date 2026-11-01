import { t } from '../shared/i18n';
import { app, dialog } from 'electron';
import updater from 'electron-updater';
const { autoUpdater } = updater;
export function configureUpdates(): void {
  autoUpdater.setFeedURL({ provider: 'github', owner: 'dufangshi', repo: 'pockymoe-app' });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', () => { /* Offline checks must not interrupt work. */ });
  autoUpdater.on('update-available', async info => {
    const answer = await dialog.showMessageBox({ type: 'info', title: t('Pockymoe 有更新'), message: t('版本 {version} 已可下载', { version: info.version }), buttons: [t('下载更新'), t('稍后')], cancelId: 1 });
    if (answer.response === 0) void autoUpdater.downloadUpdate().catch(() => undefined);
  });
  autoUpdater.on('update-downloaded', async () => {
    const answer = await dialog.showMessageBox({ type: 'info', title: t('更新已就绪'), message: t('退出时会自动安装更新。'), buttons: [t('现在重启'), t('稍后')], cancelId: 1 });
    if (answer.response === 0) autoUpdater.quitAndInstall();
  });
  if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => undefined);
}
export async function checkUpdate(): Promise<void> {
  if (!app.isPackaged) { await dialog.showMessageBox({ title: 'Pockymoe', message: t('开发版本不检查更新'), detail: t('安装打包版本后可从 GitHub Releases 获取更新。'), buttons: [t('好')] }); return; }
  await autoUpdater.checkForUpdates();
}
