# oneshot-skill-gen

Generate reusable AI agent skills from a single execution trace with lightweight human-in-the-loop guidance.

## 结构

- `docs/` — 开发文档（本地，已 gitignore）
- `scripts/` — 开发脚本
- `.dsh/` — 隔离的 dsh 开发环境（本地，已 gitignore）
- `plugin/` — dsh 插件（生成单个 skill + 步骤编辑 + composer 注入）

## 快速开始

```sh
scripts/dsh-skillgen.sh
```

启动隔离实例（`DSH_HOME=.dsh`，端口 3081）。实现路线见 `docs/skill-gen-plugin-route.md`，环境说明见 `docs/dev-environment.md`，把主 dsh 的某个 session 复制给测试实例见 `docs/copy-session.md`。

用法：会话头部“生成 Skill” → 左栏选 turn（可切换 session）→ 中栏确定挂载关系（递归父子、合成根/中间节点、5 级权重滑条）→ 右栏看最终步骤并生成。右栏 AI 润色默认开启，可以填写补充描述、查看实际发给 AI 的 prompt；生成时按层批量调用 AI（同层合并、不同层可能多次），失败会回退确定性结果；`original` 内容作为最终 AI 的参考，`manual` 内容保留人工写法，关闭 AI 则全部走确定性生成。发给模型前，模型回复会去掉代码块/表格/图片并只保留前后 400 字（确定性生成也使用同一压缩规则）；单 turn prompt 超过 800 字符时需手动填标题。回到对话，输入框上方的“Skill 步骤”按钮展开后可以“注入 skill”（填入 `/<skill-name>`）或选择步骤（填入自然语言 prompt），由你修改后手动发送。草稿会自动保存。
