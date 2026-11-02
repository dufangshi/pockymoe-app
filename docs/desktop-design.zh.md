# Pockymoe Desktop — 设计与视觉规范 v2

v2 取代 v1。v1 是在一个落后上游 800 个提交的旧基线上写的。
架构原理见 [desktop-electron-plan.zh.md](desktop-electron-plan.zh.md)。
设计负责人：主线程。改动接口契约前，必须先提出并得到确认。

## 前提（来自上游 Pockymoe 0.13.41）

- 产品已改名为 **Pockymoe**。新标识一律使用 pockymoe：
  - 应用名 `Pockymoe`；
  - appId `com.pockymoe.desktop`；
  - 页面桥 `window.pockymoeHost`。
  旧名只保留在 `docs/rename-pockymoe.md` 规定的地方。
- Web UI 可部署在 GitHub Pages（示例：`https://app.example.com`），Relay 可单独提供 API。客户端不提供默认地址，首次连接由用户填写。
  桌面主窗口加载 **Web 源**；APNs 注册走 **Relay 源**。
- 以上游 `docs/ui-principles.md` 为准，它对每一处 UI 改动都有约束。其中与本文关系最大的几条：
  - 一类操作只有一种做法；
  - 复用 `StatusMark`、`useMenuKeyboard`、`useModalFocus`、`ConfirmDialog`、`ErrorMark`、`PathChip`/`CopyButton`；
  - 状态语言见 §6；
  - 没有原生滚动条；
  - `:hover` 必须放在 `@media (hover:hover)` 里；
  - 要在三套主题（Classic / Plum Pocket / Terminal）的亮暗两种模式下都检查。
- 上游已有的桌面网页布局保持不变：品牌下方的 rail、侧栏（All workspaces / Thread map / 快捷方式 / This workspace / 最近）、作为唯一顶栏的标签行、分屏、搜索（Ctrl/⌘+F）、通知铃。
  桌面版**不另造**侧栏树和 ⌘K 面板，v1 里写的那两部分作废。

---

## 1. 桌面主窗口

```
┌─────────────────────────────────────────────────────────────────────────┐
│● ● ●  [搜索] [标签1] [标签2] [标签3]   ＋  工具 │ 连接 · 🔔            │ ← 上游标签行 = 窗口标题栏（可拖拽）
├────┬───────────┬────────────────────────────────────────────────────────┤
│rail│ 侧栏      │  主区                                                  │
│ 地图│ 活动 ▾    │   首页 = 线程地图（常驻页面，不再是对话框）            │
│ ⌂  │  需要你 2 │   或者：已打开的线程（上游工作台）                     │
│ ←→ │  进行中 3 │                                                        │
│    │  刚完成 4 │                                                        │
│    │ All ws …  │                                                        │
└────┴───────────┴────────────────────────────────────────────────────────┘
```

**标题栏融合**
- macOS：`titleBarStyle:'hiddenInset'`。上游标签行就是标题栏：左侧给交通灯留出 `trafficLightsWidth`，空白处设置 `-webkit-app-region: drag`，按钮和标签设为 `no-drag`。
- Windows：`titleBarOverlay`，右侧给系统按钮留出空间。
- rail 顶部的品牌区按需下移，避免与交通灯重叠。

**首页就是地图**
- 桌面版的 `/` 就是**线程地图页**：全尺寸、常驻挂载。
- rail 最上方的“地图”按钮或 `⌘0` 回到地图。回来时缩放层级、范围和滚动位置都保持原样。
- 地图上点一个线程，就在上游工作台里以标签打开它。

**侧栏新增“活动”分区**（放在侧栏最上面，跨所有设备）
- 分组：需要你、进行中、刚完成（未读）。
- 每一行：StatusMark、标题、`设备 · 工作区`；运行中的显示计时，等待你的显示“审批”或“输入”。
- 分区可以折叠，折叠状态写入 `pockymoe.sidebar-sections.v1`。行菜单沿用上游的 ⋯。
- 只在桌面 surface 出现（理由写进代码注释和 ui-principles 的例外段落）。

**网页上有、桌面上隐藏的东西**
- PWA 安装提示、“下载桌面版”、Web Push 订阅开关。桌面版改为显示“系统通知 · 桌宠”的设置入口，点击后打开外壳的偏好设置。

---

## 2. 线程地图 v2（桌面的主导航）

在共享 UI（`pockymoe-thread-ui` 的 `components/threadMap/`）里扩展，新增的行为都通过可选 props 打开。不传这些 props 时，Web 端对话框的行为不变。

### 2.1 新增 props 契约

```ts
<ThreadMap
  presentation="page"                 // 'dialog'（默认，现状） | 'page'（常驻，无关闭）
  scope={scope} onScopeChange={…}     // 'active' | 'week' | 'all'；page 模式默认 'week'
  attention={items}                   // MapAttention[]，见下
  stableLayout                        // 开启 §2.4 的稳定布局
  filterText={q} onFilterChange={…}   // §2.6
  deviceExtras={map}                  // 设备头部的附加信息，见 §2.7
  onQuickLook={key => …}              // Space 键或 ⓘ：打开详情浮层
  onRequestDecision={(key, id, d) => …} // 在关注条或详情浮层里批准/拒绝
  revealKey={key}                     // 外部要求“在地图中显示”：缩放到它所在的层级并闪一下
  pulseKeys={keys}                    // 刚发生事件的格子：只闪一次
/>
interface MapAttention { key: string; kind: 'approval' | 'input' | 'failed' | 'unread'; title: string;
  device: string; workspace: string; summary?: string; requestId?: string; since: string }
```

`ThreadMapThread` 新增可选字段：
- `needsInput?: { kind: 'approval' | 'input'; summary?: string; requestId?: string }`
- `unread?: boolean`
- `lastActiveAt` 字段已有，用于范围判断。

### 2.2 关注条：让活跃线程一眼可见

地图栏下方有一条横向卡片条：
- 依次为“需要你 → 失败未读 → 刚完成”，最多 6 张卡片，多出来的部分显示“另外 N 个”。
- 每张卡片 220×64，内容为：StatusMark、标题、`设备 · 工作区`、一行摘要。
- 审批类卡片直接带 `批准` / `拒绝` 按钮（拒绝是普通样式，不是危险色；两个按钮间距 ≥ 8px）。

**出现与消失**
- 没有内容时，这条不占高度。
- 出现和消失都用 160ms 的高度动画，地图本身用 FLIP 平滑跟随，不能跳。

关注条、侧栏“活动”分区和桌宠托盘，三处的条目来自**同一个数据源**（活动快照），顺序完全一致。

### 2.3 范围与压缩：把不关注的线程收起来

地图栏右侧是一个分段控件 `活跃 · 7 天 · 全部`，快捷键 `1` / `2` / `3`。

**各范围包含的线程**
- 活跃：运行中、需要你、未读、24 小时内失败的线程，以及 24 小时内有过活动的线程。
- 7 天：最近活动在 7 天以内的线程。
- 全部：所有线程（等于上游现状）。

上面三种状态（运行中、需要你、未读）的线程在任何范围下都会显示。

**范围之外的东西怎么处理**
- 每个工作区里，范围外的线程折叠成**一个“较早 N 个”格子**：
  - 权重固定为 1.5；
  - 样式为斜纹浅底；
  - 点击后只把这个工作区展开成“全部”（局部覆盖，存在会话内）。
- 一台设备里完全没有范围内线程的工作区，合并成**一个“其余 k 个工作区”格子**，点击后同样只展开这一处。
- 离线设备不再从地图上消失，统一排在末尾，显示为一条窄条：
  - 内容为 `设备名 · 离线 · 3 小时前`，使用 `DeviceStateMark` 的离线标识；
  - 点击后用最近一次缓存的数据（降低饱和度）展示它的地图，并标注“缓存”。

**范围内的权重**
- `threadWeight(turns) × 新近系数`：24 小时内为 1，7 天内为 0.7，更早为 0.45。
- 运行中和需要你的线程，权重下限是 `runningWeight`。

### 2.4 稳定布局：不跳

- `stableLayout` 开启时，格子的排列顺序采用“带滞后的排序”：
  - 只有当某个格子的权重变化超过 30%，或者用户主动刷新、切换范围时，才重新排序；
  - 指针在地图上、或焦点在地图里的时候，**冻结重排**，只更新格子内部的内容；指针离开 800ms 后再重排。
- 位置和大小的变化用 FLIP 动画过渡（200ms，`cubic-bezier(.2,.75,.25,1)`）。开启“减少动效”时直接跳到终态，不做动画。
- 新出现的格子淡入；删除的格子先缩小再移除。

### 2.5 快：秒开、不闪

- 地图的数据来自桌面索引（§3）：首帧直接用 IndexedDB 缓存渲染，**有缓存时不出现“加载中”**。
- `thread-activity` 的刷新时机：
  - 每台设备每 60 秒一次；
  - 收到 `turn.completed` / `turn.failed` 事件后，防抖 2 秒再拉一次；
  - 只在地图可见时刷新。
- 每台设备的标题行有一个很淡的同步点，表示正在刷新，不打扰阅读。

### 2.6 导航与键盘

| 操作 | 方式 |
|---|---|
| 打开线程 | 点击格子；⌘ 点击在新窗口打开（与上游“修饰键保留浏览器行为”一致） |
| 进入设备或工作区 | 点击它的标题行（保持上游行为） |
| 移动焦点 | 方向键在**空间上**移动：找当前格子在该方向上最近的格子 |
| 打开 | Enter |
| 返回上一级 | Esc / ⌫ |
| 过滤 | `/` 聚焦地图过滤框 |
| 切换范围 | `1` / `2` / `3` |
| 详情浮层 | Space（Quick Look） |

**过滤**：输入文字后，匹配的格子保持原样，不匹配的降到 30% 不透明度。地图栏显示“N 个匹配”。Enter 打开第一个匹配。不重新布局，以免跳动。

**详情浮层（Quick Look）**
- 锚定在格子旁边。用 `useModalFocus` 管理焦点：Esc 关闭，焦点回到格子。
- 内容：完整标题、StatusMark、等待你的请求摘要（附批准/拒绝）、最近一条 prompt、模型、轮数、运行时长、按小时的柱状图、tokens 和价格（价格可以展开明细，与上游一致）、“打开”“在新窗口打开”。

### 2.7 设备管理就放在地图上

设备标题行加长，内容为：
- `DeviceStateMark`、名字、往返延迟、runtime 版本（有更新时带“更新”徽标）；
- 运行中和需要你的数量、今日费用；
- 悬停时显示上游 compact monitor 的 CPU、内存，以及 GPU（如有）。

设备标题行的 ⋯ 菜单（用 `useMenuKeyboard`）：设备详情、检查更新、重命名、在浏览器中管理。

**设备详情页** `/desktop/devices/:id`（也可以从 rail 的“设备”进入，看所有设备）：
- 设备卡片，以及使用统计：KPI、每日轮数（按设备堆叠）、tokens/费用、模型分布、最忙的工作区、平均时长最长的线程。
- 再加上游 device monitor 的 CPU、内存、GPU 实时读数。
- 统计数据优先用 `/api/stats/summary`（如果移植后保留了这个接口），其次用 `thread-activity` 自己汇总。

### 2.8 和通知、桌宠联动

- 每个提醒事件都会让地图上对应的格子闪一次（`pulseKeys`）：需要你用琥珀色，完成用强调色。只在地图可见时闪。
- 桌宠气泡和系统通知的 ⋯ 菜单里有“在地图中显示”，执行 `revealInMap` 命令，地图会缩放到目标所在的层级并闪一下。
- 需要你的数量会同时出现在这几处：rail 上地图按钮的角标、Dock 角标、托盘状态点、桌宠状态。四处的数字始终一致。

---

## 3. 桌面数据层（supervisor-web `src/desktop/data`）

从旧分支移植，并按上游的现有设施做调整：上游已经有 `deviceRequest`、presence、`web-live-updates.md` 规定的请求预算，以及按设备的 socket，**先读这些再写**。

数据层负责的事情：
- 跨设备索引的 IndexedDB 缓存（库名按上游约定改为 pockymoe 前缀）；
- stale-while-revalidate；
- 按 id 做 diff 合并，保持对象引用不变；
- 每设备实时事件（只收 6 类事件）；
- 未读（`lastViewedAt`）；
- 等待你（冷启动时也要准确）；
- 活动快照的生成和 host 命令的处理。

---

## 4. 外壳、通知、桌宠

v1 的 §5（ActivityHub、投递策略、托盘、Dock、桌宠交互）和 §6（安全规则）**继续有效**。按上面的变化做以下调整：
- 设置拆成 `webOrigin` 和 `relayOrigin`。
- 新增 `appearance.sync`：页面把有效主题（亮/暗、主题包、强调色）同步给外壳，让桌宠、快捷窗口、偏好窗口、托盘与所选主题保持一致。
- 所有状态标识都遵守 §6，不再自绘一套。桌宠和快捷窗口是本地窗口，复制同一套形状（SVG），并注明来源。

---

## 5. 接口契约 v2

见 `desktop/src/shared/contract.ts`（`HOST_BRIDGE_VERSION = 2`）。相对 v1 的变化：

- `window.remoteCodexHost` 改名为 `window.pockymoeHost`。只对 `webOrigin` 的顶层 frame 暴露。
- `DesktopSettings.relayOrigin` 拆成 `webOrigin` + `relayOrigin`。
- 新增 `appearance.sync(a: { effective: 'light' | 'dark'; pack: string; accent: string; fontScale?: number })`。
- `HostCommand` 新增 `{ type: 'revealInMap'; key }` 和 `{ type: 'openMap' }`；去掉 `openPalette`（⌘K 改为聚焦上游的搜索）。

---

## 6. 状态语言（在上游 §6 的基础上新增一种）

上游的表里没有“等待你（审批 / 输入）”。新增：

| 状态 | 标识 |
|---|---|
| 等待你（审批或输入） | 琥珀色实心对话气泡（右下带尾巴），静止不动 |

在 `StatusMark` 里加 `data-status="waiting"`，三套主题各画一版，只凭形状就能认出。要同时：
- 更新 `docs/ui-principles.md` §6 的表格；
- 在三套主题的亮暗模式下各截一张图。

其余状态完全沿用上游：运行中是旋转的环、未读是实心点、失败是红色菱形、中断是琥珀色方块。v1 里那个像字母 C 的圆弧作废。

---

## 7. 视觉与质量门槛

- 不再另起一套 `--rc-*` token。一律用主题 token，让三个主题包都能生效。
- 截图验收的组合：三套主题 × 亮暗 × 两种宽度（桌面 1440 和最小 900）。地图要分别在 12 / 150 / 600 个线程下截图。
- 下列操作中不能有布局跳动或闪烁：
  - 首帧；
  - 刷新；
  - 状态变化；
  - 关注条出现或消失；
  - 切换范围；
  - 过滤。
- 达到 ChatGPT/Codex 桌面版、Linear、Raycast 的完成度：对齐、留白、动效节奏、悬停、按下和焦点状态都要做到位。

## 连接与离线

首次连接只输入一个 Pockymoe 地址。客户端不带凭据探测并跟随安全重定向：
输入 Relay 而跳到 Web 时保留输入的 Relay；同源自托管使用同一个源。
高级设置只提供单独 Relay 的覆盖值。无法访问或无法识别 Pockymoe 时，
保留连接页和输入，在字段旁显示一行解释，不进入离线页。
已连接后的离线页始终提供主操作「重试」和次操作「更改地址」；后者返回
带当前地址的连接页。升级时旧的单 Relay 设置只探测一次，成功保存源对，
失败则返回带解释的连接页；已有 Web/Relay 源对不改写。
