import { app, dialog, net, powerMonitor, shell, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron';
import { join } from 'node:path';
import { UpdateService } from './updateCore';
import { installVerified, ManualInstall } from './updateInstall';
import { t } from '../shared/i18n';
export { isNewerVersion, parseVersion } from './updateCore';
export type ShowMessage = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
const nativeMessage: ShowMessage = options => dialog.showMessageBox(options);
declare const __UPDATER_TEST_BUILD__: boolean;
declare const __UPDATER_FEED__: string;
declare const __UPDATER_PUBLIC_KEY__: string;
let service: UpdateService | undefined;
let stop: (() => void) | undefined;
export function createUpdates(allowed: () => boolean): UpdateService {
  if (service) return service;
  service = new UpdateService({ version: app.getVersion(), platform: `${process.platform}-${process.arch}`, directory: join(app.getPath('userData'), 'updates'),
    publicKey: __UPDATER_PUBLIC_KEY__, feed: __UPDATER_FEED__, testBuild: __UPDATER_TEST_BUILD__, failureMessage: () => t('安装更新失败，请重试或前往下载。'), allowed: () => app.isPackaged && allowed(),
    fetch: (url, init) => net.fetch(url, init), openExternal: url => shell.openExternal(url),
    install: async (file, entry) => {
      try { await installVerified(file, entry); }
      catch (error) { if (error instanceof ManualInstall) await service!.openDownload(); else throw error; }
    }
  });
  return service;
}
export function configureUpdates(allowed = (): boolean => true): void {
  const updates = createUpdates(allowed);
  if (stop) return;
  const check = (): void => { void updates.check(); };
  check();
  const interval = setInterval(check, 6 * 3600_000); interval.unref();
  powerMonitor.on('resume', check);
  stop = () => { clearInterval(interval); powerMonitor.removeListener('resume', check); updates.dispose(); };
  app.once('before-quit', () => stop?.());
}
export async function checkUpdate(showMessage: ShowMessage = nativeMessage): Promise<void> {
  if (!app.isPackaged) { await showMessage({ title: 'Pockymoe', message: t('开发版本不检查更新'), detail: t('安装打包版本后可从 GitHub Releases 获取更新。'), buttons: [t('好')] }); return; }
  const result = await service?.check();
  if (!result) return;
  if (result === 'manual') {
    const answer = await showMessage({ title: t('Pockymoe 有更新'), message: t('版本 {version} 已可下载', { version: service!.state().version || '' }), buttons: [t('前往下载'), t('稍后')], cancelId: 1 });
    if (answer.response === 0) await service!.openDownload();
  } else await showMessage({ title: 'Pockymoe', message: t(result === 'failed' ? '暂时无法检查更新' : result === 'latest' ? '已是最新版本' : result === 'ready' ? '更新已就绪' : '正在下载'), buttons: [t('好')] });
}
