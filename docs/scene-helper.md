# Scene 高清桥 helper 协议

`backdrop-bridge-dsh` 0.6.0 不会下载、安装或运行来源不明的可执行文件。`repkgPath` 仅接受由管理员显式配置的本地 helper 路径；在插件自己的带 SHA-256 清单的 Release 建立之前，`install` 与 `extract` API 都会安全拒绝。

未来公开 helper 的发布包必须同时包含：

```json
{
  "schemaVersion": 1,
  "version": "<semver>",
  "assetUrl": "<fixed HTTPS release URL published by the maintainers>",
  "sha256": "<64-character lowercase sha256>",
  "platform": "win32-x64"
}
```

安装器只可接受 HTTPS、固定版本和精确 SHA-256；下载至受限临时目录后校验哈希，再原子移动到 `~/.dsh/dsh-wallpaper/helpers/<version>/`。不得通过 shell 拼接参数。

上面的 `assetUrl` 是协议字段说明，不是当前可下载地址。当前版本没有公开 helper，也不会把示例字符串当作 URL 使用。

helper 的输入和输出边界如下：输入只能是插件已扫描记录所对应的 `scene.pkg`；输出只能落在 `~/.dsh/dsh-wallpaper/scene-cache/<scene-package-sha256>/`。插件仅会从该受控缓存索引出的图片中选择最高分辨率项，并仍通过 `/api/dsh-wallpaper/media?id=...` 提供，不接受任意绝对路径。

本文件是开源仓库的构建/发行契约，不代表当前版本已经提供可下载的 helper。
