# 《STEINS;GATE》原作台词用于训练：许可核查

核查日期：2026-08-26

## 结论

目前未找到由 MAGES.、NITRO PLUS 或其他已确认权利人发布的、允许公众把《STEINS;GATE》原作台词复制、抽取并用于模型训练的开放许可证。公开可下载不等于获得训练、再发布或商业使用许可。

因此，现阶段不应把网上的完整游戏脚本、动画字幕、角色台词集或音频转写作为“可自由训练数据”接入本项目。用户若有单独授权，应核对授权范围是否明确包含机器学习/文本与数据挖掘、复制保存、衍生模型、输出及商业使用。

## 依据

- [《STEINS;GATE》官方版权页](https://steinsgate.jp/legalnotice/)将系列作品标注为 `©MAGES./NITRO PLUS` 等，未提供开放数据或训练许可。
- [MAGES. 游戏视频与静态图发布指南](https://game.mages.co.jp/guideline/)说明其多数文字冒险游戏不开放传播；许可仅限名单中的标题和特定发布方式，未列出的标题禁止发布。该指南也没有授予抽取台词或训练模型的权利。
- [《STEINS;GATE RE:BOOT》官方指南](https://steinsgate.jp/reboot/ja-jp/guideline/)明确不许可直播/投稿，并把主机分享功能限定在私人、个人使用范围。这虽不是训练条款，但反映官方没有提供面向公众的宽泛再利用授权。

## 网上数据集为何不能直接视为安全素材

- [Hugging Face `steinsgate-voice`](https://huggingface.co/datasets/ntaquan0125/steinsgate-voice)页面显示许可证为 `unknown`，并声明游戏材料 `All Rights Reserved`，下载者自行承担合规责任。
- [GitHub `amadeus`](https://github.com/e-p-armstrong/amadeus)维护者明确表示 MIT 只用于代码，数据集适用何种许可并不清楚，并要求使用者自行确认对视觉小说文本的权利。
- 即使第三方仓库给台词 CSV 标注 MIT 或“非商业可用”，也不能据此确认上传者有权重新许可 MAGES./NITRO PLUS 的原作台词。GitHub 的[许可说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)同样说明，公开仓库本身不等于获得复制、分发和创作衍生作品的权利。

## 可采用的低风险素材路线

1. 自行创作不复述剧情和标志性台词的角色风格规则、场景标签与示例对话，并为这些原创文本保留来源记录。
2. 使用合成对话训练“理性、反问、克制关心、科学论证”等抽象语言特征，不复制原句。
3. 仅在获得权利人书面许可且许可范围覆盖训练用途后，导入原作文本；同时保存授权文件、适用地域、期限和商业限制。
4. 用户合法持有的游戏/字幕文件可以在本地建立待审核清单，但“购买了副本”本身不能证明拥有训练或再发布许可。

本页是项目风险核查记录，不是针对任何司法辖区的法律意见。
