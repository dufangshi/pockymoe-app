# Remote Codex Desktop — 设计与视觉规范（v1）

本文是实现规范，所有开发者以本文为准。架构原理见 [desktop-electron-plan.zh.md](desktop-electron-plan.zh.md)。
设计负责人：主线程。如需改动本文中的接口契约，先提出，等确认后再动。

参考了这些产品：
- ChatGPT/Codex 桌面版：宠物悬浮层、活动托盘、快捷聊天条、通知去重。
- Claude 桌面版：hybrid 宿主桥、托盘常驻、Buddy 的 session feed 模式。
- Linear：侧栏密度、Inbox、⌘K。
- Slack：未读优先、跳到下一个未读。
- VS Code：树、输入即过滤、面包屑。
- Arc：侧栏层级、固定区。
- Raycast：命令面板、键盘优先。
- Things：留白与排版节奏。

---

## 0. 总体结构

```
remote-codex-app/desktop/          Electron 外壳（main / preload / 本地窗口）
  src/main/                        主进程：窗口、托盘、菜单、通知、ActivityHub、更新、APNs
  src/preload/                     host bridge（只对 relay origin 暴露）
  src/pet/                         桌宠窗口（本地打包）
  src/quick/                       快捷窗口（全局快捷键）
  src/shared/                      主进程与本地窗口共享的类型（契约 §6）
  assets/pets/<id>/                宠物包（pet.json + spritesheet.webp）
remoteCodex/apps/supervisor-web/src/desktop/   桌面端 surface（跑在 relay 页面里）
  host.ts                          host bridge 客户端 + HostCapabilities
  data/                            跨设备索引（缓存、实时、合并）
  nav/                             树形导航、智能分区、过滤、命令面板
  devices/                         设备总览与统计
  DesktopShell.tsx                 桌面布局外壳
```

**主窗口始终加载 relay 页面。** 页面检测到 `window.remoteCodexHost` 后，渲染 `DesktopShell`。浏览器里打开时，网页版行为完全不变。

---

## 1. 桌面主窗口布局

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● ● ●   [◧] 设备 › 工作区 › 线程标题                ⌘K 搜索   [＋]  [◨]  │  ← 统一工具栏 38px（可拖拽）
├───────────────┬──────────────────────────────────────────────┬───────────┤
│ 侧栏 264px    │  主区：线程视图（复用 ThreadDetailPage）     │ 检查器    │
│ (180–420 可拖) │                                              │ (可选)    │
│               │                                              │ Explorer/ │
│ 需要你  2     │                                              │ Terminal  │
│ 进行中  3     │                                              │           │
│ 刚完成  4     │                                              │           │
│ ───────────── │                                              │           │
│ ▾ MacBook Pro │                                              │           │
│   ▾ remoteCo… │                                              │           │
│     ◐ 修复登录│                                              │           │
│ ...           │                                              │           │
│ ───────────── │                                              │           │
│ 账号 · 设置 · 🐾│                                              │           │
└───────────────┴──────────────────────────────────────────────┴───────────┘
```

**窗口外观**
- macOS：`titleBarStyle:'hiddenInset'`，交通灯位置 `{x:14,y:13}`；侧栏使用 `vibrancy:'sidebar'`，主区为不透明背景。
- Windows 11：`titleBarOverlay`（高 38px，颜色跟随主题），`backgroundMaterial:'mica'`；侧栏半透明。

**工具栏**
- 左侧：侧栏开关 `⌘\`；后退/前进 `⌘[` `⌘]`；面包屑。面包屑每一段都可点击，并带下拉菜单，可在同级之间切换。
- 右侧：搜索框（占位文字为“搜索线程、工作区、命令”，点击即打开 ⌘K）；新线程 `⌘N`；检查器开关 `⌘⌥\`。

**主区**
- 复用现有的线程页、工作区页、新建线程页。
- 浏览器 chrome 相关的部分隐藏掉：网页版顶部的 ProductHeader、移动端底栏。

**关窗与退出**
- 关闭窗口时 App 不退出，转入托盘或菜单栏。`⌘Q` 才真正退出。

---

## 2. 树形导航（主导航）

### 2.1 层级

```
智能分区（跨设备）
  需要你     等待审批、等待输入、最近 24h 内失败且未查看的线程
  进行中     status=running|recovering 的线程
  刚完成     完成后用户还没打开过的线程（未读）
树
  设备 ▸ 工作区 ▸ 根线程 ▸ 子 agent 线程（lineage，可以多层）
```

### 2.2 行的样式（26px 行高，紧凑；13px 字号）

```
[缩进 12px/层][展开 ▸][状态图标 14][标题 …][徽标/计时][hover 操作]
```

**状态图标**：只用颜色和形状表达，不用 emoji；SVG 绘制，统一尺寸。

| 状态 | 图标 | 颜色（token） |
|---|---|---|
| 需要你 | 实心圆点，外加 1 圈缓慢呼吸的光环（2.4s） | `--rc-attn` 琥珀色 |
| 运行中 | 270° 圆弧，1.1s 一圈 | `--rc-run` 品牌钴蓝 |
| 失败 | 实心菱形 | `--rc-fail` 红 |
| 未读完成 | 6px 实心圆点 | `--rc-unread` 前景主色 |
| 空闲 | 不画图标，但保留占位，保证标题对齐 | — |
| 已关闭的 agent | 空心圆，标题为 muted 色 | — |

**右侧信息**
- 运行中：显示 `mm:ss` 计时，等宽数字（`font-variant-numeric: tabular-nums`）。
- 需要你：显示“审批”或“输入”小标签。
- 其他：显示相对时间（“3 分钟”“昨天”），muted 色。

**汇总（rollup）**
- 折叠的节点显示子树的汇总，例如设备行显示 `◐3 ●1`，工作区行同理。
- 这样把活动“冒泡”上来：即使节点折叠，也能看见下面有活跃线程。

**hover 操作**（行右侧淡入，替换掉相对时间）
- 线程：置顶、重命名、更多。
- 工作区：新线程、更多。
- 设备：刷新、更多。

**选中态**：背景 `--rc-row-selected`，左侧加 2px 强调色条。键盘焦点用 1px 焦点环。

**设备行**
- 在线：绿点。离线：整行降低不透明度，显示“离线 · 3 小时前”，默认折叠，并沉到列表底部。

### 2.3 线程很多时，压缩与过滤

**每个工作区的“关注集”**，默认只显示以下线程：
- 置顶的；
- 活跃的：需要你、运行中、未读；
- 最近 7 天更新过的，最多 5 条（不含上面已列出的）。

其余线程折叠成一行“`… 其余 23 个线程`”，点开后懒加载渲染。

**不活跃的工作区**：14 天内没有活动、也没有置顶线程的工作区，在每个设备下归入“不活跃的工作区（k）”分组，默认折叠。

**子 agent**
- 只在根线程下面嵌套显示。
- 已关闭的子 agent 默认隐藏，显示为一行“`显示已关闭的 3 个`”。
- 运行中或需要你的子 agent 总是显示，并让其祖先节点自动展开一层。

**过滤栏**：位于智能分区下方，平时只显示一个图标，聚焦后展开。
- 输入即过滤（`⌘⇧F` 聚焦侧栏过滤）：
  - 模糊匹配标题、工作区名、设备名、agentName；
  - 命中的部分高亮；
  - 保留命中节点的祖先节点，祖先自动展开。
- 范围切换（segmented）：`全部 / 活跃 / 置顶`。
  - “活跃”模式：只保留包含活跃线程的分支，等同于聚焦模式。
- 提供方筛选（Codex / Claude / ACP…）：放在更多菜单里。

**记忆**
- 每个节点的展开状态、侧栏宽度、过滤模式，都按账号持久化。

### 2.4 排序与稳定性（防跳动）

**排序规则**
- 设备：在线优先，然后按名字排序。
- 工作区：按最近活动时间倒序；收藏的工作区靠前。
- 线程：置顶优先，然后按活动时间倒序。

**防跳动**
- **指针悬停在侧栏上，或者键盘焦点在树里时，冻结重排**：只更新行内的状态和计时，不改变行的位置。指针离开 800ms 后，再用 FLIP 动画（160ms）完成重排。
- 新出现的行淡入（120ms），不推挤别的行。删除的行先折叠高度（120ms），再移除。

### 2.5 键盘

| 键 | 作用 |
|---|---|
| ↑/↓ | 移动焦点（虚拟列表） |
| ←/→ | 折叠或展开；在叶子节点上按 ← 跳到父节点 |
| Enter | 打开 |
| ⌘Enter | 在新窗口打开 |
| ⌥⇧↓ / ⌥⇧↑ | 跳到下一个/上一个“需要你或未读”的线程（与 Slack 一致） |
| ⌘1…⌘9 | 跳到智能分区里的第 n 项 |
| ⌘K | 命令面板 |
| ⌘N | 在当前工作区新建线程 |
| ⌘⇧N | 新建线程并选择位置 |
| ⌘⇧P | 切换宠物显示 |
| ⌘, | 设置 |

### 2.6 命令面板 ⌘K（Raycast / Linear 风格）

**外观**
- 居中浮层，宽 640px，顶部是输入框，下面是分组结果。分组依次为：线程、工作区、设备、操作。
- 空输入时显示：需要你、最近打开过的 8 个、常用操作。

**行为**
- 搜索跨所有设备的本地索引，**零网络延迟**。
- 每行结果右侧显示设备和工作区的路径。

**操作**：新线程、切换设备、打开设备总览、切换宠物、暂停通知 1 小时、主题切换、在浏览器打开当前页。

---

## 3. 加载：快、不闪

1. **索引缓存**
   - 跨设备索引存在 IndexedDB 里（库名 `rc-desktop-index`，按 relay origin 加账号 id 区分）。内容包括设备、工作区、线程摘要，只存 `ThreadDto` 中渲染必需的字段。
   - 退出登录时清空。
   - 启动时**同步读取缓存，首帧就把树画出来**，目标 <150ms。
2. **重新验证（stale-while-revalidate）**
   - 每个设备并行请求 `/api/workspaces` 和 `/api/threads?includeAgentThreads=true`。
   - 结果按 id 做 diff 合并：没变化的行，对象引用保持不变，配合 `React.memo` 不触发重绘。
3. **骨架屏只用于“从没见过”的节点**，而且延迟 200ms 才显示。如果 200ms 内数据已到，就完全不出现骨架屏。
   **禁止**整树换成 spinner，也禁止数据一刷新就清空列表。
4. **实时更新**
   - 每个在线设备一条 WS（复用现有的 `/relay/devices/:id/ws`），处理以下事件：
     - `thread.updated`、`thread.turn.started`、`thread.turn.completed`、`thread.turn.failed`：增量更新树；
     - `thread.request.created` / `thread.request.resolved`：维护“需要你”分区。
   - 其他高频事件（`output.delta`、`item.*`）在索引层直接丢弃，不进 React state。
   - WS 断开后按 1s→2s→5s→15s 退避重连；重连成功后补拉一次列表。
   - 离线设备不连 WS，每 30s 探测一次在线状态（复用 `useDevicePresence` 的逻辑）。
5. **线程切换**
   - hover 线程行 120ms 后，预取线程详情的第一页。
   - 内存里用 LRU 保留最近 8 个线程的详情；最近 3 个线程的视图保持挂载（keep-alive，用 `display:none`），切换时滚动位置不丢，切回来是瞬间的。
6. **虚拟化**：树使用 `@tanstack/react-virtual`，行高固定 26px。1 万个线程时滚动也要保持 60fps。
7. **未读的判定**
   - 每个线程记录 `lastViewedAt`，存在本地索引里。
   - `lastTurnCompletedAt > lastViewedAt` 视为未读。
   - 打开线程并停留超过 1.5s，或者滚动到底部，就标记为已读。

---

## 4. 多设备管理与统计（“设备”页，从侧栏底部或 ⌘K 打开）

### 4.1 设备总览

卡片网格，每个卡片 320×176，自适应列数。

```
┌ MacBook Pro ───────────── ● 在线 42ms ┐
│ remote-codex 0.12.59 · 有更新 0.12.60  [更新]│
│ ◐ 3 运行中   ● 1 需要你   12 工作区   84 线程 │
│ 今日 37 轮 · 1.2M tokens · ≈ $4.80          │
│ ▁▂▅▇▃▂▁▁▃▆▇▅  近 14 天活动                  │
└────────────────────────────────────────────┘
```

**卡片内容**
- 在线状态和往返延迟：用一次轻量请求测得。
- runtime 版本和“有更新”提示。更新按钮调用 Settings 里现有的 Check/Update 管理 API，不另写一套。
- 运行中、需要你、工作区数、线程数。
- 今日的轮数、tokens 和估算费用。
- 近 14 天每天的轮数，用 sparkline 展示。

**卡片操作**：打开（在树里定位到该设备）、新线程、重命名、更新、在浏览器中管理。

离线设备显示最后在线时间，统计数据用缓存值，并标注“缓存 · 3 小时前”。

### 4.2 统计详情（点进设备，或者在页面顶部切换到“全部设备”）

- **时间范围**：今天 / 7 天 / 30 天。
- **KPI 行**：总轮数、成功率、平均轮时长、总 tokens、估算费用。
- **图表**
  - 每日轮数，按设备分色的堆叠柱状图；
  - 每日 tokens 或费用，折线；
  - 模型分布条；
  - 最忙的 5 个工作区；
  - 平均时长最长的线程。
- **数据来源**
  - 优先用现有接口：线程列表，以及线程详情和轮次里的 `tokenUsage`、`priceEstimate`，再加上 `useSubscriptionUsage`。
  - 如果设备支持新增的 `/api/stats/summary?range=` 端点（这是 runtime 的增强，需要做能力探测），就用它，避免逐个线程去拉数据。
  - 都不可用时，只展示能算出来的项，并标注“部分数据”。
- **图表规范**：遵循 dataviz 原则。一张图只讲一件事；坐标轴极简；颜色映射按设备固定；亮色和暗色主题都要验证；tooltip 显示精确值。

---

## 5. 通知、托盘与桌宠的联动

### 5.1 ActivityHub（主进程中的唯一事实来源）

- 渲染进程（relay 页面）把**脱敏后的活动快照**推给主进程：通过 `host.activity.sync(snapshot)`，全量推送，节流到 ≤4 次/秒，内容有变化才发。
- 主进程做 diff，得到这些事件：`started`、`needsInput`、`completed`、`failed`、`resolved`。
- 再分发给四个出口：系统通知、托盘、Dock 角标、桌宠。

### 5.2 投递策略（设置项：“提醒方式”，默认为“桌宠优先”）

| 条件 | 桌宠气泡 | 系统通知 |
|---|---|---|
| 当前正在查看该线程，且窗口有焦点 | 不出现 | 不发 |
| 桌宠可见，且用户活跃（系统空闲 < 2 分钟） | 出现 | 只有“需要你”才发 |
| 桌宠隐藏，或用户已空闲 ≥ 2 分钟 | 出现（如果可见） | 发 |
| 系统处于勿扰或专注模式 | 宠物进入“睡觉”姿态，不说话 | 交给系统处理 |

**两条出口之间互相同步**
- 点击气泡或点击通知：都会打开对应线程，标记已读，并关闭另一条出口上的同一提醒（调用 `Notification.close()`，或者让气泡消失）。
- 同一个 id（`deviceId:turnId`，审批类为 `deviceId:requestId`）只提醒一次。

**节奏控制**
- 同一个线程 30 秒内最多出一次气泡。
- 多个事件同时到来时，合并成一条：“3 个任务完成”。

**其他出口**
- Dock 角标（macOS）/ 任务栏 overlay（Windows）：显示“需要你”的数量；没有的时候显示运行中的数量（角标用空心样式），都没有就不显示。
- 托盘图标：模板图标加一个状态点（需要你 > 运行中 > 无）。
- 托盘菜单：
  - 需要你、进行中的列表，最多各 5 条，点击打开对应线程；
  - “显示桌宠”；
  - “暂停提醒 1 小时”；
  - 打开主窗口；
  - 退出。

### 5.3 桌宠（交互完全对齐 Codex Pets，再加上边缘停靠）

**状态与优先级**：需要你 > 出错 > 刚完成 > 运行中 > 空闲 > 睡觉（勿扰时）。

| 宠物状态 | 图集行 | 触发 |
|---|---|---|
| idle | 0 | 空闲 |
| running-right / running-left | 1 / 2 | 拖动时，按拖动方向 |
| waving | 3 | 刚完成（播放一次，然后回到 idle） |
| jumping | 4 | 多个任务一起完成，或用户点击 |
| failed | 5 | 出错 |
| waiting | 6 | 需要你 |
| running | 7 | 有任务在运行 |
| review | 8 | 等待审阅，或者 hover 任务卡时 |

**窗口**
- 透明、无边框、不抢焦点、置顶（floating），在所有 Space 可见，全屏的 App 上也可见。
- 只有角色本体、气泡、控制条是可点击的；其余透明区域点击穿透。
- 实现：`setIgnoreMouseEvents(true,{forward:true})`，由渲染进程做命中检测后再切换。

**拖拽与停靠**
- 自由拖动。松手时离屏幕边缘不到 24px，就吸附到该边缘。
- 停靠后只露出约 55% 的身体，倾斜 ±12°，像“趴”在屏幕边缘；动画 300ms，ease-out-cubic。
- 停靠时点击：探出身体并展开任务托盘；再点一次缩回去。
- 位置按显示器分别记住；显示器拔掉后回到主屏右下角。

**hover 控制条**（鼠标靠近 60px 时淡入，学 Codex 的 pet controls）
```
[💬 聊天] [▤ 任务] [⌂ 打开主窗口] [⋯]
```

**任务托盘**（点击宠物，或点控制条上的“任务”）
- 宠物旁边弹出一个 320px 宽的卡片栈，向屏幕内侧展开。
- 按“需要你、进行中、刚完成”分组，跨设备、跨项目显示，也就是“跨项目任务卡”。
- 每张卡片：
  - 状态图标、标题、`设备 · 工作区`、运行计时或结果摘要的第一行；
  - 操作按钮：需要你的卡片是 `[批准] [拒绝] [打开]`，刚完成的是 `[打开] [回复]`。

**聊天条**（Mini 聊天，同一个会话）
- 气泡下方展开一个单行输入框，对**最近一次提醒的那个线程**直接回复，可以下拉切换目标线程。
- 发送通道：主进程 → 主窗口渲染进程 → 现有的发送 API。宠物窗口不持有任何密钥。

**气泡**
- 圆角 12px 的卡片，最大宽度 280px，带一个指向宠物的小尾巴。
- 显示 6–10 秒后自动消失（需要你的气泡不会自动消失，直到问题解决）。
- 文案示例：
  - “修复登录 完成了 · 3m12s”
  - “remoteCodex 需要你批准：运行 `cargo test`”

**Mini 模式**（同 Codex）：只显示控制条加活动托盘，不显示角色。

**设置项**：显示宠物、选择宠物（内置 + 导入的 Codex 宠物包）、大小（S 96 / M 128 / L 160）、提示音开关、Mini 模式。

**导入**
- 选择一个包含 `pet.json` 和 `spritesheet.webp|png` 的文件夹，或者 zip。
- 校验图集尺寸：1536×1872 的 8×9 格，或 v2 的 8×11 格。

**无障碍**：开启“减少动态效果”时只播放首帧；所有按钮都有可读的标签。

---

## 6. 接口契约（main ⇄ preload ⇄ relay 页面 ⇄ 本地窗口）

`desktop/src/shared/contract.ts` 是唯一来源。supervisor-web 里的 `src/desktop/host.ts` 照抄同样的类型，并且标注版本号。

```ts
export const HOST_BRIDGE_VERSION = 1;

export interface HostCapabilities {
  surface: 'desktop';
  bridgeVersion: number;
  platform: 'darwin' | 'win32' | 'linux';
  shellVersion: string;
  notifications: 'local';          // L1；APNs 可用时为 'local+apns'
  windowChrome: { kind: 'hiddenInset' | 'titleBarOverlay'; trafficLightsWidth: number; toolbarHeight: number };
  features: { pet: boolean; quickWindow: boolean; multiWindow: boolean; nativeSave: boolean; badge: boolean };
}

export type ActivityState = 'needsInput' | 'failed' | 'completed' | 'running' | 'idle';

export interface ActivityItem {
  key: string;                // `${deviceId}:${threadId}`
  deviceId: string; deviceName: string;
  workspaceId: string; workspaceLabel: string;
  threadId: string; title: string; agentName?: string | null;
  state: ActivityState;
  since: string;              // 进入当前状态的 ISO 时间
  turnId?: string | null;
  unread: boolean;
  request?: { id: string; kind: 'approval' | 'input'; summary: string } | null; // summary ≤ 140 字
  resultSummary?: string | null;  // 完成/失败时的第一行，≤ 140 字
  durationMs?: number | null;
}

export interface ActivitySnapshot {
  version: 1; generatedAt: string; accountId: string;
  focusedThreadKey: string | null;   // 当前主窗口正在看、且窗口有焦点
  items: ActivityItem[];             // 只含 needsInput/failed(24h 内未读)/completed(未读)/running
}

// relay 页面看到的 window.remoteCodexHost（preload 只对配置的 relay origin 顶层 frame 暴露）
export interface RemoteCodexHost {
  capabilities(): Promise<HostCapabilities>;
  activity: { sync(snapshot: ActivitySnapshot): void };
  onCommand(listener: (cmd: HostCommand) => void): () => void;  // 主进程 → 页面
  commandResult(id: string, result: { ok: boolean; error?: string }): void;
  window: { openThread(path: string, opts?: { newWindow?: boolean }): void; setTitle(t: string): void };
  shell: { openExternal(url: string): void; showItemInFolder?(token: string): void };
  files: { saveAs(name: string, data: ArrayBuffer | Blob): Promise<{ saved: boolean; path?: string }> };
  pet: { setVisible(v: boolean): void; isVisible(): Promise<boolean> };
  settings: { get(): Promise<DesktopSettings>; set(patch: Partial<DesktopSettings>): Promise<DesktopSettings> };
  badge: { set(count: number, style: 'attention' | 'running' | 'none'): void };
}

export type HostCommand =
  | { id: string; type: 'navigate'; path: string }                 // 点击通知、气泡、托盘项
  | { id: string; type: 'markRead'; key: string }
  | { id: string; type: 'resolveRequest'; deviceId: string; threadId: string; requestId: string; decision: 'approve' | 'deny' }
  | { id: string; type: 'reply'; deviceId: string; threadId: string; text: string }
  | { id: string; type: 'openPalette' } | { id: string; type: 'newThread' } | { id: string; type: 'openDevices' };

export interface DesktopSettings {
  relayOrigin: string;
  alertMode: 'petFirst' | 'system' | 'both';
  petVisible: boolean; petId: string; petSize: 'S' | 'M' | 'L'; petMini: boolean; petSound: boolean;
  launchAtLogin: boolean; quickWindowShortcut: string;   // 默认 'Alt+Space'（mac: Option+Space）
  snoozeUntil: string | null;
}
```

**本地窗口（pet、quick）使用的 IPC**：命名空间为 `rcDesktop`，同样使用 contextBridge，只暴露具名方法。
- `pet.onState(listener)`：接收 `{ items: ActivityItem[]; petState; bubble }`。
- `pet.action(...)`：发送 `{ type: 'open' | 'approve' | 'deny' | 'reply' | 'dismiss' | 'toggleTray' | 'drag*' }`。

**安全规则**
- 只有当顶层 frame 的 origin 严格等于 `settings.relayOrigin` 时，才暴露 `remoteCodexHost`。iframe 和其他 origin 一律拿不到。
- `contextIsolation:true`、`sandbox:true`、`nodeIntegration:false`。
- `setWindowOpenHandler`：relay 同源的链接在 App 内打开，其他链接交给 `shell.openExternal`。

---

## 7. 视觉规范

### 7.1 设计 token

桌面端在现有的 `--theme-*` 之上，增加 `--rc-*` 这一层。浏览器里的网页版不受影响。

- **字体**
  - UI 用 `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", sans-serif`。
  - 字号 13px，行高 18px。次要文字 12px。标题 15px/600。
  - 计时和计数用 `ui-monospace, "SF Mono", "Cascadia Mono"`，并加 `tabular-nums`。
- **间距**：基于 4px，常用 4/6/8/12/16/24。侧栏内边距 8px。
- **圆角**：行 6px，卡片 10px，浮层 12px，按钮 6px。
- **颜色**：中性灰为主，强调色沿用产品的琥珀金（`--theme-accent`）。运行态用钴蓝 `oklch(0.62 0.16 255)`，和 App 图标的钴蓝呼应。
  - `--rc-attn: oklch(0.80 0.15 75)`
  - `--rc-run: oklch(0.62 0.16 255)`
  - `--rc-fail: oklch(0.63 0.20 25)`
  - `--rc-ok: oklch(0.70 0.14 155)`
  - `--rc-row-hover: color-mix(in oklch, var(--theme-fg) 6%, transparent)`
  - `--rc-row-selected: color-mix(in oklch, var(--theme-accent) 16%, transparent)`
- **阴影**
  - 浮层：`0 12px 32px -8px rgb(0 0 0 / .28), 0 0 0 1px rgb(0 0 0 / .06)`。
  - 暗色主题：改用 1px 内描边加更深的阴影。
- **动效**：常规过渡 120–160ms，`cubic-bezier(.2,.8,.2,1)`；面板展开 200ms。尊重系统的 `prefers-reduced-motion`。
- **图标**：lucide，1.5px 描边，16px。状态图标使用 §2.2 的自绘 SVG。

### 7.2 质量门槛（验收时逐项检查）

- 亮色和暗色两套主题都要截图验证；Windows 下 Mica 和不透明两种情况都要截图验证。
- 下列场景都不能出现布局跳动：
  - 首帧；
  - 刷新；
  - 线程状态变化；
  - 侧栏宽度拖动；
  - 窗口缩放到最小宽度 900px。
- 文本截断用 `…`，hover 时显示完整标题的 tooltip（延迟 600ms）。
- 所有可点击元素都有 hover、active 和焦点三种状态；键盘可以完成全部导航。
- 桌宠在 Retina 和 1x 屏幕上都要清晰，边缘不能有白边或杂色像素（素材必须是干净的 alpha）。
