# dsh-wallpaper（`backdrop-bridge-dsh` 0.6.0）

**dsh-wallpaper** 是 Wallpaper Engine 与 DeepSeek Harness 的壁纸联动插件：扫描本机素材库，并在同一个「壁纸」入口中提供三类操作。源码、问题追踪和安全更新以 [GitHub 仓库](https://github.com/kdzhang-hub/dsh-wallpaper) 为准。

由于 npm 上已存在同名包 `dsh-wallpaper@0.1.1`，当前 npm 分发、CLI 与 DSH bundle 技术标识为 `backdrop-bridge-dsh`；这不影响项目和仓库名称 `dsh-wallpaper`。

- 设为 DeepSeek Harness 全窗口背景；
- 交给 Wallpaper Engine 播放为动态桌面；
- 将静态图片设为 Windows 原生桌面壁纸。

原 `dsh-wallpaper-skin` 的活动依赖已经合并到本插件；旧源码目录可以保留作回滚备份，但不应再与本插件同时加载。

## 开源许可、素材与归属

本项目代码和文档按 [Apache-2.0](LICENSE) 许可证发布。该许可只覆盖本仓库贡献者有权授权的内容；完整边界见 [NOTICE.md](NOTICE.md)。

- npm 包不包含 Wallpaper Engine 工程、Steam Workshop 下载、预览图、视频、`scene.pkg` 或用户上传内容。壁纸仍属于各自权利人，使用或再分发前由使用者自行确认许可。
- 本项目与 Wallpaper Engine、Steam、Steam Workshop、DeepSeek 和 DeepSeek Harness 的权利人没有官方关联、背书或赞助关系。
- 文中 ATRI-Theme-DSH 仅作为“背景 + 半透明面板 + 双强调色 + 可调设置”的视觉行为参考；本包不包含其角色素材、宿主核心补丁或构建哈希选择器。未来若引入外部代码或素材，维护者必须在 `NOTICE.md` 记录来源、版本和许可证。

公开发布前仍需要版权持有人填写真实的代码托管地址、问题追踪地址和私密安全报告渠道；原因及检查项见 [PUBLISHING.md](PUBLISHING.md)。

## 安全边界与 Harness 背景行为

- 背景层位于独立的负层级堆叠上下文并永久 `pointer-events:none`。宿主属性识别、媒体加载或其他皮肤适配失败时，只会关闭壁纸显示，绝不会隐藏聊天、SSH、文件区、编辑器或任何 Harness 交互。
- 图库是独立右侧抽屉，不替换聊天区；「壁纸」入口优先紧跟 SSH，SSH 缺失时才回退到任务板或“新建会话”。宿主侧栏重渲染后会校验父节点和相邻顺序再放回。

- MP4/WebM 使用独立的固定 `<video>` 层，静音、循环、`cover` 播放；页面隐藏时暂停，恢复可见时继续。
- Wallpaper Engine `scene.pkg` 不能由浏览器直接解码，因此使用项目的 `preview.gif`、`preview.jpg` 等预览图。
- 扫描时会读取预览分辨率（上传图片也会读取），并优先选择项目根目录中更高分辨率的 `wallpaper` / `background` / `preview` 图片。自动适配会比较素材和当前窗口的宽高比：相近比例铺满；竖图、方图、超宽图或比例明显不匹配时使用“模糊环境填充 + 不模糊 contain 主体”，让主体完整可见且全窗口没有空边。短边不足 720px 的预览始终走这一安全模式，避免把小图直接裁切拉满全屏。
- 系统启用“减少动态效果”或视频加载失败时自动回退到预览图。
- 所有 GIF 背景都会从其自身帧延迟计算循环时长，并提前跳过末尾 15%（至少 120ms、最多 300ms）：插件在重置前会捕获接近安全结束点的当前帧，保持该冻结帧直到新 GIF 的首帧完成解码，以避免循环边界黑/白闪屏或跳回旧首帧。此策略不修改 Wallpaper Engine 原始文件；MP4/WebM 继续使用浏览器原生循环。
- 背景层 `pointer-events: none`，不接管鼠标或键盘事件；侧栏、对话区、文件区和 Composer 采用半透明颜色层与可调 `backdrop-filter`，形成可见的毛玻璃质感。弹窗、菜单、代码和编辑器保持高不透明度以保证可读性。
- 每次应用壁纸都会在浏览器内对当前图片或视频海报取色，自动派生面板、边框、按钮、活动项和悬停色；不依赖固定壁纸或本机主题。
- 「界面适配设置」可调背景暗化（0–100%）、壁纸亮度（50–150%）、铺满/完整显示、面板不透明度（15–90%）、输入区不透明度（30–100%）、毛玻璃强度（0–32px），并可在自动取色和手动双强调色之间切换。
- 可选安全预设仅定义双强调色、标题、空态和提示文案；不会接受 HTML、脚本、远程 URL 或任意 CSS，未选预设时完全使用自动适配。
- 自动模式从每张壁纸派生主强调色和第二强调色，分别驱动标题/活动项与主按钮/发送按钮；手动模式可覆盖两种颜色。默认暗色遮罩为 35%、面板不透明度为 52%、输入区不透明度为 84%、毛玻璃为 8px。
- 设置写入共享状态，刷新、重启和多窗口同步后仍保留。
- 共享状态原子保存到 `~/.dsh/dsh-wallpaper/skin-state.json`，多个窗口通过 revision 轮询、窗口聚焦和 `BroadcastChannel` 同步。
- 首次启动且宿主尚无状态时，会尝试迁移旧键 `dsh.wallpaperskin.skin`；迁移成功后删除旧键。
- 「壁纸」入口由独立观察器固定在 SSH 下方；宿主侧栏重渲染把节点移动到其他位置时会自动放回。
- 打开图库后，插件每 6 秒轻量刷新一次本机 Wallpaper Engine 创意工坊与本地项目目录；窗口恢复到前台时也会立即刷新。新下载的壁纸会自动出现在图库中，但绝不会未经操作自动替换当前 Harness 背景。

## Agent 工具

- `wallpaper_list`：列出 Wallpaper Engine、本地项目和上传图片。
- `wallpaper_harness`：`apply` / `random` / `clear` 控制 Harness 背景，可传 `scrim`、`panelOpacity`、`inputOpacity`、`blur`、`paletteMode`、`accentColor` 和 `secondaryAccentColor`。
- `wallpaper_apply`：只控制 Windows/Wallpaper Engine 桌面，保留 0.1 版 `we` / `native` / `random` 契约。
- `wallpaper_status`：报告 Wallpaper Engine 发现状态和当前桌面壁纸。

## 本机回环 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dsh-wallpaper/status` | 引擎发现状态与当前桌面壁纸 |
| GET | `/api/dsh-wallpaper/list` | 图库；支持 `q` / `type` / `tag` |
| GET | `/api/dsh-wallpaper/preview?p=...` | 兼容旧客户端的白名单图片预览 |
| GET/HEAD | `/api/dsh-wallpaper/media?id=...` | 按扫描 ID 流式提供 Harness 媒体；支持单段 HTTP Range |
| GET | `/api/dsh-wallpaper/skin` | 读取共享 Harness 状态及解析后的媒体描述 |
| POST | `/api/dsh-wallpaper/skin` | `{ action, id?, scrim?, panelOpacity?, inputOpacity?, blur?, brightness?, backgroundFit?, presetId?, paletteMode?, accentColor?, secondaryAccentColor?, expectedRevision? }` |
| GET/POST | `/api/dsh-wallpaper/scene-bridge` | 读取或受控操作 Scene 高清桥；当前只接受显式本地 helper，未知下载会拒绝 |
| POST | `/api/dsh-wallpaper/apply` | 旧桌面接口：`{ id, mode, imagePath? }` |
| POST | `/api/dsh-wallpaper/upload?name=...` | 上传图片，最大 64 MB |

所有路由都限制为同源本机回环请求。`media` 只接受壁纸 ID，不接受绝对路径；视频通过 `createReadStream` 发送，不会整体读入内存。

## 前置条件

- Windows 上可运行的 DeepSeek Harness Web Profile；先至少启动一次 `dsh web`，让 `DSH_HOME/profiles/web/` 存在。
- 可运行 Harness 的 Node.js/npm 环境。插件依赖 `@deepseek-ai/dsh-tools@^0.1.0-rc.6`、`@deepseek-ai/schemastery@^3.18.1`，并要求 `@deepseek-ai/cordis@^4.0.1` 由宿主提供。
- Wallpaper Engine 不是启动插件的硬性前提：没有它时，Wallpaper Engine 图库与 WE 桌面播放不可用；插件上传的图片和已有本地配置仍可使用。要播放 Scene、视频或 Web 桌面壁纸，必须安装并运行 Wallpaper Engine。

## 配置

插件默认通过 Windows 注册表、Steam 的 `libraryfolders.vdf` 和常见安装目录自动发现 Wallpaper Engine，通常不需要填写路径。只有自动发现失败时才使用可选覆盖项：

```yaml
- id: wallpaper
  name: 'backdrop-bridge-dsh'
  config:
    enabled: true
    announceToAgent: true
    installDir: '<Wallpaper Engine 安装目录>' # 可选，仅自动发现失败时填写
    workshopDir: '<Steam workshop/content/431960 目录>' # 可选
    uploadsDir: '<自定义上传目录>' # 可选，默认 ~/.dsh/dsh-wallpaper/uploads
    repkgPath: '<受信任本地 RePKG helper>' # 可选，默认关闭
    repkgSha256: '<helper SHA-256>' # 可选但推荐，配置后不匹配即拒绝运行
```

## 安装、验证与卸载

### 推荐：使用发布包的 CLI

先在目标用户的 DSH 环境中执行：

```powershell
npx backdrop-bridge-dsh@0.6.0 doctor
npx backdrop-bridge-dsh@0.6.0 install
```

`doctor` 的 JSON 输出应满足 `profileFound: true`；`install` 的输出还应满足 `packageFound: true` 和 `registered: true`。随后只重启一次 `dsh web`，在 SSH 下方打开“壁纸”入口，选择一张壁纸后确认聊天、SSH、文件区、编辑器、菜单和键盘操作都仍可用。

若 DSH 主目录不在默认位置，先在同一个 PowerShell 会话指定它：

```powershell
$env:DSH_HOME = 'D:\path\to\.dsh'
npx backdrop-bridge-dsh@0.6.0 doctor
npx backdrop-bridge-dsh@0.6.0 install
```

### 手动安装（供 Profile 维护者使用）

在活动 Web Profile 的 `package.json` 中安装包并注册 bundle；下面是需要合并的字段，不要覆盖已有依赖或 bundles：

```json
{
  "dependencies": {
    "backdrop-bridge-dsh": "^0.6.0"
  },
  "dsh": {
    "profile": {
      "bundles": ["backdrop-bridge-dsh"]
    }
  }
}
```

然后在该 Profile 目录使用其现有包管理器安装依赖并重启 Harness 一次。`install` 会从 bundles 中移除旧的 `dsh-wallpaper` 条目并注册 `backdrop-bridge-dsh`，但不会删除旧包文件，便于人工回滚。避免同时注册 `backdrop-bridge-dsh` 与已归档的 `dsh-wallpaper-skin`。

本地开发时可以临时使用 `link:<插件源码绝对路径>`，该路径必须由开发者按自己电脑填写，不属于发布配置。Profile 只加载 `/plugins/backdrop-bridge-dsh/client.js`。

### 卸载

以下命令只操作当前指定的 DSH Profile：

```powershell
npx backdrop-bridge-dsh@0.6.0 uninstall
npx backdrop-bridge-dsh@0.6.0 uninstall --purge  # 同时删除托管包、状态、上传素材和 Scene 缓存
```

`uninstall` 默认只移除 Profile 注册，保留已复制的包、状态、上传素材和缓存以便恢复；只有显式 `--purge` 才删除它们。删除前请自行备份需要保留的上传素材。

## 本地数据、进程与网络边界

- 首次扫描会读取当前用户可访问的 Steam 注册表项、`libraryfolders.vdf`、Wallpaper Engine 项目目录及其 `project.json`/预览文件；扫描结果只用于本机图库和本地回环 API。
- 插件会在 `~/.dsh/dsh-wallpaper/` 写入 `skin-state.json`、上传图片、Scene 缓存，以及 Windows 原生壁纸所需的受管 PowerShell helper。CLI `install` 还会修改目标 Profile 的 `package.json` 和 `node_modules/dsh-wallpaper`。
- 只有用户在界面中选择、调用 Agent 工具或请求本机 API 时，插件才会启动 Wallpaper Engine 的本机控制命令或设置 Windows 原生壁纸。Harness 背景操作不会改变 Windows 桌面；桌面操作也不会改变 Harness 背景。
- 0.6.0 不上传壁纸、不发送遥测、不会下载或自动执行 Scene helper。路由仅接受本机回环请求；详见 API 一节及 [SECURITY.md](SECURITY.md)。

## 可移植性

- 不依赖用户名、固定盘符、当前壁纸 ID 或 Harness 构建生成的哈希类名。
- 客户端通过稳定语义属性和 CSS 变量适配界面，并从每台电脑当前选择的壁纸运行时取色。
- 自动取色会同时生成侧栏、对话区和输入区的半透明表面，以及符合对比度要求的主文字、次文字、弱文字、链接、边框和强调色；更换壁纸后这些语义颜色会一起更新。
- Wallpaper Engine 可安装在任意 Steam 库；插件优先读取注册表与 `libraryfolders.vdf`，常见盘符仅作为发现失败时的兜底。

## 限制

- 目标环境为 Windows；WE 桌面模式需要 Wallpaper Engine 可用。
- 本版本不尝试在浏览器里运行 `scene.pkg`；Scene 完整动态效果仍由 Wallpaper Engine 桌面播放。
- 低清环境模式只能减少放大和裁剪，不能凭空恢复 `scene.pkg` 内的原始细节；需要完整高清 Scene 时仍应使用 WE 播放，或后续配置受信任的可选 Scene 解包桥。
- Scene 高清桥默认关闭。RePKG 官方目前没有可直接使用的官方 Release helper；本版本不会下载未知二进制。后续开源仓库建立固定版本、HTTPS 和 SHA-256 清单后，才可安全安装对应 helper；接口和发布契约见 [`docs/scene-helper.md`](docs/scene-helper.md)。
- Windows 原生桌面只接受 jpg/png/bmp/webp 等静态图片；GIF、Scene 和视频请使用 Harness 或 WE 操作。

## 维护与发布

- 贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。
- 对外发布前执行 [PUBLISHING.md](PUBLISHING.md) 的技术检查和人工验收；不要把本机 DSH Profile、`node_modules`、壁纸、测试上传文件、密钥或绝对路径提交到公开仓库。
