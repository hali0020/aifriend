把你有权处理的 `.txt`、`.json`、`.jsonl`、`.srt`、`.vtt` 或 `.ass` 素材放在这里。

然后在项目根目录执行：

```powershell
npm run corpus:build -- --confirm-rights
```

原始文件只在本机读取，不会上传。请勿放入来源不明或未获训练授权的完整原作脚本。

`quarantine/` 是待审核隔离区。构建脚本会无条件跳过该目录；只有完成来源、授权和内容审核后，才应把获准文件复制到本目录的其他位置。
