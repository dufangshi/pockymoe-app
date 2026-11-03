import { app, dialog, net, powerMonitor, shell, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron';
import { join } from 'node:path';
import { UpdateService } from './updateCore';
import { prepareInstall, ManualInstall, InsufficientSpace } from './updateInstall';
import { UpdateCancelled } from './updateWindows';
import { t } from '../shared/i18n';
export { isNewerVersion, parseVersion } from './updateCore';
export type ShowMessage = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
const nativeMessage: ShowMessage = options => dialog.showMessageBox(options);
declare const __UPDATER_TEST_BUILD__: boolean;
declare const __UPDATER_FEED__: string;
declare const __UPDATER_PUBLIC_KEY__: string;
let service: UpdateService | undefined;
let stop: (() => void) | undefined;
export function createUpdates(allowed: () => boolean, lifecycle?: { close(): Promise<void>; restore(): Promise<void> }): UpdateService {
  if (service) return service;
  service = new UpdateService({ version: app.getVersion(), platform: `${process.platform}-${process.arch}`, directory: join(app.getPath('userData'), 'updates'),
    publicKey: __UPDATER_PUBLIC_KEY__, feed: __UPDATER_FEED__, testBuild: __UPDATER_TEST_BUILD__, failureMessage: reason => t(reason === 'previousAttempt' ? '上次更新没有完成' : reason === 'retryLimit' ? '更新连续失败 3 次，请重启应用后重试。' : reason instanceof UpdateCancelled ? '有未保存的文件，已取消更新' : reason instanceof InsufficientSpace ? '磁盘空间不足，已取消更新。' : '安装更新失败，请重试或前往下载。'), allowed: () => app.isPackaged && allowed(),
    fetch: (url, init) => net.fetch(url, init), openExternal: url => shell.openExternal(url),
    install: async (file, entry) => {
      let prepared;
      try {
        prepared = await prepareInstall(file, entry);
        if (!lifecycle) throw new UpdateCancelled();
        await lifecycle.close();
        await prepared.commit();
      } catch (error) {
        await prepared?.cancel();
        if (error instanceof ManualInstall) await service!.openDownload();
        else { await lifecycle?.restore(); throw error; }
      }
    }
  });
  return service;
}
export function configureUpdates(allowed = (): boolean => true): void {
  const updates = createUpdates(allowed);
  if (stop) return;
  void updates.check('startup');
  const interval = setInterval(() => { void updates.check('timer'); }, 3600_000); interval.unref();
  const wake = (): void => { void updates.check('wake'); };
  const focus = (): void => { void updates.check('focus'); };
  powerMonitor.on('resume', wake);
  app.on('browser-window-focus', focus);
  stop = () => { clearInterval(interval); powerMonitor.removeListener('resume', wake); app.removeListener('browser-window-focus', focus); updates.dispose(); };
  app.once('before-quit', () => stop?.());
}
export async function checkUpdate(showMessage: ShowMessage = nativeMessage): Promise<void> {
  if (!app.isPackaged) { await showMessage({ title: 'Pockymoe', message: t('开发版本不检查更新'), detail: t('安装打包版本后可从 GitHub Releases 获取更新。'), buttons: [t('好')] }); return; }
  const result = await service?.check();
  if (!result || result === 'deferred') return;
  if (result === 'unverified') {
    await showMessage({ title: 'Pockymoe', message: t('发现版本 {version}，但无法验证它的签名，不提供更新', { version: service!.unverified() }), buttons: [t('好')] });
  } else await showMessage({ title: 'Pockymoe', message: t(result === 'failed' ? '暂时无法检查更新' : result === 'latest' ? '已是最新版本' : result === 'ready' ? '更新已就绪' : '正在下载'), buttons: [t('好')] });
}
