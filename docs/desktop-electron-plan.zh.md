# Remote Codex 桌面版（Electron）方案

状态：草案，2026-11-01。本文的调研依据有三类：

- 本机安装包的拆包结果：ChatGPT.app 26.1027.30824 和 Claude.app 3.6556.2。
- 公开文档：Codex Pets 文档、openai/skills 里的 `hatch-pet` skill。
- remoteCodex 的 relay 推送代码：`crates/relay/src/notifications.rs`、`apns.rs`。

文中凡是没有亲手验证的结论，都标注为“推断”或“需验证”。

---

## 1. 调研结论：两家官方 App 是怎么做的

### 1.1 ChatGPT 桌面版（即原 Codex App，2026-07 并入 ChatGPT）

**技术栈**
- Electron，但用的是 OpenAI 自己维护的分支。框架被改名为 `Codex Framework.framework`，内核是 Chromium 156。
- 代码里调用了 `BrowserWindow.isInputShapeSupported()`，上游 Electron 没有这个 API。

**UI 来源**
- UI 打包在本地：`app.asar` 里有 `/webview/assets/*`，通过 `app://` 协议加载。
- 同时启动一个本地 `app-server`，所以桌面版能直接读写本机文件、运行 git 和终端。

**推送**
- entitlement 里有 `aps-environment` 和 `usernotifications.communication`。
- 流程：先调用 `pushNotifications.registerForAPNSNotifications()` 拿到 APNs token，再 `POST /notifications/subscription/register`，请求体为 `{token, platform:"macos", app:"chatgpt", build, bundle_id}`。
- 也就是说，App 没在运行时，由服务端经 APNs 把推送送到 Mac。

**本地通知**
- 主进程里有一个通知管理器，做了这几件事：
  - `visibleConversations`：当前正在看的会话不弹通知。
  - `deliveredNotificationIds`：按 id 去重。
  - 可以播放自定义提示音。

**宠物与悬浮层**（`avatarOverlayManager`）
- 窗口：透明、置顶、所有 Space 可见；用 input shape 实现透明区域点击穿透；是不抢焦点的 nonactivating panel；还有一个 notch 控制器。
- 交互：快捷聊天条可以吸附到屏幕边缘；有全局快捷键唤起的 hotkey window。
- 宠物包格式：`pet.json` + `spritesheet.webp`，8×9 的图集，每格 192×208。
- 状态有 4 种，多个会话同时活跃时按这个优先级显示：Needs input > Blocked > Ready > Running。
- 宠物可以通过 URL 安装（`petInstall`）。
- 这就是白龙适配版所说的“Codex 的 Mini”。

### 1.2 Claude 桌面版

**技术栈**
- 标准 Electron 44.9.3（Chromium 152）。
- 另外带了两个原生扩展：`@ant/claude-swift` 和 `@ant/claude-native`。

**UI 来源：hybrid 模式**
- 主窗口直接加载远端的 `https://claude.ai`，地址可以通过 `claudeAiUrl` 配置。
- preload 只在顶层 frame 的 origin 属于 claude.ai、claude.com 或本地时，才暴露带类型的 IPC 命名空间，比如 `claude.hybrid.DesktopIntl`。
- 纯桌面功能各自是一个打包在本地的小窗口：`quick_window`、`buddy_window`、`find_in_page`、`file_viewer`、`local_exec_consent`、`about_window`。

**推送**
- **没有 APNs entitlement。** 通知全部由主进程在 App 运行时用 `new Notification()` 发出。
- 发通知时会带上 tag 去重、可选的操作按钮，以及 macOS 的通知 `id`。
- 让 App 一直活着的手段：
  - 托盘或菜单栏图标（`menuBarEnabled`）；
  - 开机自启（`setLoginItemSettings`）；
  - 关掉窗口不等于退出 App。
- 配合通知的辅助手段：Dock 角标（`dock.setBadge`）、Dock 弹跳（`dock.bounce`），以及全局快捷键唤起的 quick window。

**Buddy**
- 这是一个蓝牙硬件伴侣，不是屏幕上的桌宠（相关代码：`hardwareBuddyEnabled`、`BuddyBleTransport`）。
- 数据流：渲染进程调用 `BuddyRemoteFeed.sync(sessions)`，把会话摘要推给主进程，主进程转发到设备；设备上的审批结果以 `permissionDecision` 事件回传。
- **这个模式值得直接照搬到我们的桌宠上：** 主窗口里的网页是唯一的数据源，它把脱敏后的会话摘要推出去，审批决定再从外面回传进来。

### 1.3 “优雅”从哪里来

两家都没有用纯原生 UI，产品的主界面就是网页。显得优雅，靠的是网页之外那一圈桌面行为做得到位：

1. **常驻**：有托盘或菜单栏图标，开机自启，关掉窗口不退出。只要 App 活着，通知就不会漏。
2. **轻量入口**：全局快捷键唤起小窗口；悬浮层或宠物不抢焦点，透明的地方能点穿。
3. **通知讲究**：
   - 当前正在看的会话不弹；
   - 同一事件只弹一次；
   - 点通知直接打开对应会话；
   - 有角标和 Dock 弹跳。
4. **原生外壳**：用系统的交通灯按钮和隐藏式标题栏，有原生菜单和快捷键；外部链接用系统浏览器打开，下载弹系统的保存对话框。
5. **App 不在运行时的推送**：只有 ChatGPT 做了（APNs）。Claude 的思路是只要保证 App 常驻就够了。

---

## 2. 推送方案

背景约束：
- relay 解不开设备的加密内容。所以 `notifications.rs` 生成的推送正文只能是固定的一句“A thread turn completed”。
- relay 只接受 `completed` 和 `failed` 两种事件，“等待审批”这类状态它不知道。
- Electron 不支持 Web Push（`PushManager.subscribe` 不可用），因此网页版现有的 `relayPush.ts` 在桌面端用不上。

方案分三层：

| 层 | 场景 | 机制 | 能显示的内容 |
|---|---|---|---|
| L1 | App 在运行，包括窗口已关闭、只剩托盘的情况 | 主窗口里的 relay 网页保持加密连接，把解密后的活动摘要经 IPC（`desktop.activity.sync`）推给主进程。主进程负责发本地通知，并驱动桌宠。 | 完整内容：线程标题、结果、耗时、**等待审批**、错误摘要 |
| L2 | macOS 上 App 没在运行 | Electron 调 `pushNotifications.registerForAPNSNotifications()`，拿到 token 后走现有的 `POST /relay/account/notifications/native` 注册 | 只有固定文案 |
| L3 | Windows 上 App 没在运行 | 没有 APNs；WNS 要求 MSIX 包身份，不值得做。依靠开机自启和托盘常驻，把这种情况尽量压到最少 | 无 |

**L1 是主路径，要先做好。** 它与 Claude 的做法相同，并且是唯一能显示“等待审批”和线程标题的一层。

### 2.1 L1 的去重与抑制

通知 id 统一用 `deviceId:turnId`。relay 推送事件的 `tag` 已经是这个格式，两层可以对齐。

满足下面任意一条时，不发系统通知：
- 用户当前正在看该线程，并且窗口处于焦点；
- 这个 id 已经通知过；
- 系统处于勿扰或专注模式。这一条交给系统处理，我们不绕开。

点击通知后：打开或聚焦主窗口，跳到 `/devices/:id/threads/:id`。

审批类通知可以带“批准 / 拒绝”按钮。点了按钮，主进程回调渲染进程，由渲染进程通过加密通道发出审批决定，这和 Claude Buddy 的 `permissionDecision` 是同一种模式。

### 2.2 L2 需要 relay 做的改动（remoteCodex 仓库）

1. **APNs topic 改成按订阅区分。**
   - 现状：topic 取自全局唯一的 `REMOTE_CODEX_APNS_TOPIC`，只有 iOS 一个 bundle id。
   - 改法：订阅记录里加一个 `apnsTopic`，或者加 `appKind: "ios" | "macos-desktop"`。允许的取值由服务端白名单控制，不能由客户端随意填写。
2. **避免和 L1 重复弹出。**
   - App 在后台运行时，系统可能会先弹一条 relay 的固定文案通知，L1 再弹一条完整内容的。
   - 做法：APNs 请求带 `apns-collapse-id = tag`，本地通知也用同一个 id，让完整内容的通知覆盖掉固定文案的那条。（需验证：Electron 通知的 `id` 选项能否替换已送达的远程通知。）
3. **（P3）增加“等待审批”离线事件。**
   - 让 supervisor 在进入等待审批状态时，也向 outbox 投递一条事件。
   - 状态值扩展为 `awaiting_input`，推送正文同样是固定文案，不泄露内容。
   - 这一项会同时惠及 iOS。

---

## 3. 网页版和桌面版的差异怎么处理

原则：**只有一套产品 UI，差异按“宿主能力”切换，不分叉代码。** 这和 ChatGPT 网页版与桌面版的关系是一个道理：功能主体相同，桌面版多出一层外壳行为，个别入口会换一种形态。

### 3.1 主窗口加载远端 relay（Claude 的 hybrid 模式），而不是像 ChatGPT 那样打包在本地

理由有三条：
- Web UI 由 relay 部署（`relay-deploy.yml`）。远端加载的话，桌面端自动跟随 Web 更新，外壳很少需要发版。
- 加密密钥、cookie 和 Service Worker 都绑定在 relay 的 origin 上。如果改成从 `app://` 加载，origin 就变了，登录态、加密存储和路由都要重新处理。
- ChatGPT 选择本地打包，是因为它有一个本地 app-server 需要配合。我们的执行端在远端设备上，没有这个需求。

### 3.2 宿主桥（host bridge）

- preload 只在**顶层 frame 的 origin 等于用户配置的 relay origin** 时，才暴露 `window.remoteCodexHost`。其他页面一律拿不到。
- 开启 `contextIsolation` 和 `sandbox`。
- 只暴露具名方法，不暴露通用的 `ipcRenderer`。

这个接口同时把移动端现有的 `web/native-bridge.js` 统一进来。三种宿主共用一个能力描述：

```ts
type HostCapabilities = {
  surface: 'web' | 'desktop' | 'mobile';
  bridgeVersion: number;           // 外壳和 Web UI 各自独立发版，按能力探测，不按版本号写死
  notifications: 'webpush' | 'local' | 'apns';
  windowChrome?: { trafficLights: 'hiddenInset'; dragRegion: true };
  shortcuts?: true; multiWindow?: true; pet?: true; nativeSave?: true;
};
```

Web 端用一个 `useHostCapabilities()` 来读取。宿主不支持的能力，就回退到网页原本的行为。外壳版本较旧时，新的 Web UI 也必须能正常工作。

### 3.3 差异清单（第一版）

| 方面 | 网页 | 桌面 |
|---|---|---|
| 标题栏和布局 | 浏览器自己的 chrome | 隐藏式标题栏和交通灯按钮；侧栏顶部留出空位；`-webkit-app-region: drag` 拖拽区 |
| 通知设置 | Web Push 订阅开关 | 隐藏 Web Push 开关，改为“系统通知”“桌宠”“提示音”“审批通知带按钮”几个选项 |
| 下载和导出 | 浏览器下载 | 系统保存对话框，加“在 Finder / 资源管理器中显示” |
| 链接 | 新标签页 | relay 内部链接留在 App 内；外部链接用系统浏览器打开；也可以把线程在新窗口中打开 |
| 快捷键 | 只有页面内快捷键 | 原生菜单加 Cmd/Ctrl+N、K、1–9；另有一个全局快捷键唤起快捷窗口 |
| 文件拖入 | 走浏览器上传 | 能拿到本机真实路径（`webUtils.getPathForFile`），作为附件上传 |
| 登录 | 当前页面 | OAuth 在 App 内同一 session 的窗口中打开，cookie 互通（Google 可能会拦截嵌入式窗口，需验证） |
| 更新 | relay 部署 | UI 跟随 relay；外壳后台检查并验证签名安装包；草稿/未保存文件确认后安装重启，卸载被拒则取消；无有效签名不提供链接；旧版手动下载 |
| 只在网页出现 | PWA 安装提示、“下载桌面版”横幅 | 桌面端隐藏这两项 |
| 只在桌面出现 | — | 托盘菜单（活跃任务列表）、Dock 角标（待审批数或进行中数）、桌宠、快捷窗口 |

### 3.4 纯桌面窗口

桌宠、快捷聊天条和托盘弹出面板，这三个**打包在 Electron 本地**，不从 relay 加载。

- 它们复用 `@remote-codex/thread-ui` 的设计 token 和一些小组件，比如状态点、线程卡片、按钮。
- **这些窗口不持有加密密钥。** 它们只消费主进程转发过来的脱敏摘要，需要执行操作时再回传给主窗口。
- 这样做的好处：安全边界只有主窗口一个，桌面窗口很轻，也不需要等 Web 发版。

---

## 4. 桌宠

### 4.1 数据流

```
relay 网页（主窗口，持有密钥与连接）
   └─ host.activity.sync([{deviceId, threadId, title, workspace, state, since, approval?}])
        ▼ IPC
主进程 ActivityHub（聚合跨设备、跨项目的数据，做去重和优先级计算）
   ├─▶ 系统通知（L1）
   ├─▶ 托盘菜单 / Dock 角标
   └─▶ 桌宠窗口（只拿摘要）
            └─ 用户在桌宠上点“批准”、快速回复或打开线程
                 ▼ IPC → 主进程 → 主窗口网页 → 加密通道 → 设备
```

我们比 Codex 多一个优势：**一个桌宠能汇总所有设备上所有项目的任务**。“跨项目任务卡”在我们这里是天然就有的能力。

### 4.2 状态映射

沿用 Codex 的优先级和图集行。

| 我们的事件 | 桌宠状态和优先级 | 图集行 | 气泡或卡片 |
|---|---|---|---|
| 等待审批 / 需要输入 | Needs input（最高） | waiting | “『修复登录』需要你批准：运行 `rm …`”，附 [批准] [拒绝] [打开] |
| 失败 / 中断 | Blocked | failed | 显示错误摘要，附 [打开] |
| 完成 | Ready | waving / jumping | “『修复登录』完成 · 3m12s”，附 [打开] [回复] |
| 进行中 | Running | running | 悬停时显示任务卡列表 |
| 空闲 | Idle | idle | 偶尔播放一段闲置动画 |

### 4.3 素材格式和版权

- **直接采用 Codex 宠物包格式**：`pet.json` 加 `spritesheet.webp`，8×9 图集，每格 192×208。这个格式的契约（`hatch-pet` skill）是 Apache-2.0 授权的，OpenPets 等社区项目也已经兼容。用户可以直接导入现成的 Codex 宠物，以后还可以兼容社区的 v2 格式（`spriteVersionNumber: 2`）。
- **白龙的美术、动画、台词都不能拿来用。** 原作仓库没有许可证，README 和 `ASSETS.md` 明确表示不授予再分发和商用权利，适配版的 NOTICE 也声明不授予任何权利。要内置白龙，必须先取得 @風-隐 的书面授权。默认桌宠要用原创素材，或者授权清晰的素材。
- 白龙在交互上有几处值得借鉴：
  - 吸附到屏幕边缘时只露出大约 55%，并带一个倾斜角度；
  - 气泡按优先级排队；同一句话 5 分钟内最多出现一次；
  - 有其他 App 全屏时自动隐藏。

### 4.4 窗口实现（标准 Electron 即可，不需要像 OpenAI 那样维护分支）

- 窗口参数：`transparent`、`frame:false`、`focusable:false`、`hasShadow:false`；macOS 上加 `type:'panel'`（Claude 也是这么用的）。
- 置顶：`setAlwaysOnTop(true,'floating')`，加 `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})`。
- 点击穿透：默认 `setIgnoreMouseEvents(true,{forward:true})`。渲染进程根据鼠标是否落在角色的不透明区域或气泡上，切换成可点击状态。标准 Electron 没有 ChatGPT 用的 input shape API，只能这样做。
- 吸附：拖动结束时距离屏幕边缘不到 24px 就吸附。按显示器分别记住位置；显示器被拔掉时回到主屏。
- 动画：用 CSS 的 `background-position` 播放图集，每帧时长按 `hatch-pet` 的约定。开启“减少动态效果”时只显示静态帧。
- 提示音：可以关闭，并做频率限制。

---

## 5. 工程落地

**位置**
- 代码放在 `remote-codex-app/desktop/`，技术栈为 Electron、TypeScript 和 Vite。不放进 remoteCodex，遵守那边的 50k 行限制，也不能往那边放客户端源码。
- 不和 Windows Device Manager 合并：那是独立发版的引导程序，这是客户端，两者各自发版。

**与旧的 macOS SwiftUI 版的关系**：已决定删除（2026-11-01）。Electron 版是唯一的桌面端。

**签名**：当前公开 macOS 构建使用固定、无个人信息的自签名证书，硬化运行时关闭，不公证；Windows NSIS 未做 Authenticode 签名。两平台的安装包元数据以独立 Ed25519 密钥签在 Release body 中。未发布验证每次使用一次性元数据密钥，只有 clean main 上显式 --publish 使用生产 Ed25519 密钥；本机私钥以 0600 保存，防 GitHub 账号泄露伪造更新，不防以本机同一用户身份运行的代码。Developer ID、公证和 APNs 配置仍需另行准备。

### 分期

| 期 | 内容 | 涉及仓库 |
|---|---|---|
| P0 外壳 | 选择 relay、主窗口远端加载、托盘、开机自启、关窗不退出、原生菜单和快捷键、下载接管、外链处理、外壳签名校验与应用内更新、签名打包 | remote-codex-app |
| P1 宿主桥和通知 | `remoteCodexHost` 和 `HostCapabilities`；`activity.sync`；L1 本地通知（含去重、抑制、点击跳转、审批按钮）；Dock 角标；Web 端按能力适配标题栏、通知设置和下载 | 两个仓库，Web 部分要走 relay 部署 |
| P2 桌宠 MVP | 透明悬浮窗、Codex 图集播放器、状态映射、气泡、任务卡、吸附、导入宠物包、一个原创默认宠物 | remote-codex-app |
| P3 离线推送 | macOS APNs 注册；relay 按订阅区分 topic 并加 collapse-id；supervisor 投递 `awaiting_input` 事件 | 两个仓库 |
| P4 增强 | 全局快捷键快捷窗口（同一会话快速回复）、多窗口、桌宠上直接聊天 | remote-codex-app |
