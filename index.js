// @nyxfold/dsh-qq-schedule — 给 QQ 桥加 /日程 和 /待办。
//
// 主包 @nyxfold/dsh-qq-bridge 只做管子，不认日程/待办这种业务命令。它收到
// 认不出来的 /xxx 时会 ctx.emit('qq/command', payload) 广播出去；本插件监听
// 这个事件，匹配上就同步把 payload.handled 置 true（这样桥不再把它当普通消息
// 投给会话），然后异步读数据、把结果用 payload.reply() 发回 QQ。
//
// 没装主包时：没人 emit，本插件安静待着，不报错。
// 没装本插件时：/日程、/待办 退回老行为（当普通消息投给会话）。
import { createSchedule } from './src/schedule.js'

export const name = 'dshQqSchedule'
export const inject = []

/** 配置归一化：缺什么用默认，坏值不炸。 */
function normalizeConfig(config) {
  const c = config && typeof config === 'object' ? config : {}
  return {
    // 桌面待办小窗的数据目录（todos.txt / classes.txt / events.txt / cfg.txt）。
    // 空 = 读不到，回一句说明；不会写这个目录。
    todoAppDir: String(c.todoAppDir || '').trim(),
    // /日程 默认看几天（从今天算，含今天）。
    scheduleDays: Number(c.scheduleDays) > 0 ? Number(c.scheduleDays) : 7,
  }
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config)

  // 插件日志：优先走 ctx.logger，没有就静默（日志不能把桥弄崩）。
  const log = {
    warn: (...args) => {
      try {
        ctx.logger?.('qq-schedule')?.warn?.(...args)
      } catch {
        /* logging must never break the command */
      }
    },
    info: (...args) => {
      try {
        ctx.logger?.('qq-schedule')?.info?.(...args)
      } catch {
        /* ignore */
      }
    },
  }

  const { scheduleSnapshot, todoSnapshot } = createSchedule({ cfg, log })

  const SCHEDULE_RE = /^[/／]?(?:日程|课表|schedule)(?:\s+([\s\S]{1,12}))?$/i
  const TODO_RE = /^[/／]?(?:待办|清单|todo|todos)(?:\s+([\s\S]{1,12}))?$/i

  /** 异步回复，失败就回一句"没读出来"，不抛。 */
  function answer(payload, promise, failureText) {
    promise
      .then((text) => payload.reply?.(text))
      .catch((error) => {
        log.warn?.(`${failureText}：${error instanceof Error ? error.message : String(error)}`)
        Promise.resolve(payload.reply?.(failureText)).catch(() => {})
      })
  }

  ctx.effect(
    () =>
      ctx.on('qq/command', (payload) => {
        if (!payload || payload.handled) return
        const text = String(payload.text || '')

        const scheduleCommand = SCHEDULE_RE.exec(text)
        if (scheduleCommand) {
          // 同步打标记：桥 emit 完立刻看这个字段，异步回复不影响它。
          payload.handled = true
          answer(payload, scheduleSnapshot(scheduleCommand[1] || ''), '日程没读出来，等下再试。')
          return
        }

        const todoCommand = TODO_RE.exec(text)
        if (todoCommand) {
          payload.handled = true
          answer(payload, todoSnapshot(todoCommand[1] || ''), '待办没读出来，等下再试。')
          return
        }
      }),
    'qq-schedule.commands',
  )
}
