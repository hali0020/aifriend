# 授权语音素材区

- `quarantine/`：所有新取得的素材先放这里，不直接用于训练。
- `approved/`：通过来源核验、哈希记录、文件类型检查和恶意软件扫描后再移入。
- `reports/`：保存扫描报告和素材清单。

执行检查：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\scan-audio-quarantine.ps1
```

当前没有从第三方网盘、游戏解包站或非官方音效站下载任何文件。

