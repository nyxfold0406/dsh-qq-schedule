# dsh-qq-schedule

**给 [@nyxfold/dsh-qq-bridge](https://www.npmjs.com/package/@nyxfold/dsh-qq-bridge) 加两个 QQ 命令：`/日程` 和 `/待办`。**

主包只做管子，不做业务命令。这个插件是可选扩展：在 QQ 上发 `/日程`（或 `/课表`），
它把「桌面待办小窗」的纯文本数据念成一张手机能看的小票；发 `/待办` 则是清单。

不装它：主包一切照旧，只是这两个命令会被当成普通消息投给会话。
装了但没装主包：它安静待着，什么都不做，也不报错。

---

## 安装

```powershell
dsh plugin add @nyxfold/dsh-qq-schedule
```

然后把它挂进 profile（和主包一样的方式），配 `todoAppDir` 指向你的待办小窗目录：

```yaml
# cordis.patch.yml（本包自带，也可以覆盖到 profile）
- insert:
    - id: qq-schedule
      name: '@nyxfold/dsh-qq-schedule'
      config:
        todoAppDir: 'C:\Users\you\桌面待办'
        scheduleDays: 7
```

重启 DSH 生效。

---

## 数据从哪来

`todoAppDir` 下是纯文本文件，格式与「桌面待办小窗」一致：

| 文件 | 内容 |
|---|---|
| `todos.txt` | 待办清单（优先级、分类、截止日期） |
| `classes.txt` | 课表 |
| `events.txt` | 日程事件 |
| `cfg.txt` | 小窗的配置 |

插件**只读不写**：要改数据，去小窗本体或 `todo.py` 改。

---

## 命令

| 你说 | 它回什么 |
|---|---|
| `/日程` / `/课表` | 从今天起 `scheduleDays` 天内的课表与事件 |
| `/日程 3` | 只看 3 天 |
| `/待办` / `/清单` | 待办清单（按优先级） |

---

## 实现

主包在收到自己认不出来的 `/xxx` 时会 `ctx.emit('qq/command', { text, uin, reply, handled })`。
本插件监听这个事件，匹配上就把 `handled` 置 `true`（桥因此不再把消息投给会话），
然后异步读文件、用 `reply()` 发回 QQ。

零 npm 依赖，MIT。
