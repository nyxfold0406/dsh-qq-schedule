// 日程 / 待办快照：把「桌面待办小窗」的纯文本数据拼成手机能看的小票。
//
// 数据源是纯文本（todos.txt / classes.txt / events.txt / cfg.txt），格式见
// todo-app/README.md（发布包里带着那个小程序）。这里**只读不写**：改数据走
// todo.py 或小窗本体，桥只负责念出来。所以没有缓存——每次被问都重新读一遍。
//
// 和 activity.js 一样，这两个快照由桥自己答，不唤醒会话：手机上问"这周有什么"，
// 不该排在某个正在跑的回合后面。
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const PRIO_ORDER = ['S', 'A', 'B', 'C', 'D', 'E']
const CATS = ['日常', '特殊', '重要']
// 一条小票的正文上限（名字类字段截断用），太长 QQ 上读不动。
const NAME_MAX = 20
const TEXT_MAX = 22

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地日期 → 'YYYY-MM-DD'（不能用 toISOString，那个是 UTC）。 */
export function ymd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 'YYYY-MM-DD' → 当天 0 点；解析不了返回 null。 */
export function parseYmd(value) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || '').trim())
  if (!m) return null
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date, n) {
  const out = startOfDay(date)
  out.setDate(out.getDate() + n)
  return out
}

/** 'HH:MM' → 距 0 点分钟；解析不了返回 -1。 */
export function toMin(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!m) return -1
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return -1
  return h * 60 + min
}

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function normCat(value) {
  const s = String(value || '').trim()
  return CATS.includes(s) ? s : '日常'
}

function normPrio(value) {
  const s = String(value || '').trim().toUpperCase()
  return PRIO_ORDER.includes(s) ? s : ''
}

/** 文本 → 行数组（去掉空行、尾随 CR）。 */
function lines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim())
}

// ---------------------------------------------------------------- 解析 ---

/**
 * todos.txt：`状态<TAB>截止<TAB>耗时<TAB>紧要度<TAB>文字`
 * 旧的两段/三段/四段格式仍然能读（和小窗本体、todo.py 的兼容规则一致）。
 */
export function parseTodos(text) {
  const out = []
  for (const line of lines(text)) {
    const p = line.split('\t')
    if (p.length < 2) continue
    const item = { done: p[0].trim() === '1', due: '', min: '', prio: '', text: '' }
    if (p.length >= 5) {
      item.due = p[1].trim()
      item.min = p[2].trim()
      item.prio = normPrio(p[3])
      item.text = p[4].trim()
    } else if (p.length === 4) {
      item.due = p[1].trim()
      item.min = p[2].trim()
      item.text = p[3].trim()
    } else if (p.length === 3) {
      item.due = p[1].trim()
      item.text = p[2].trim()
    } else {
      item.text = p[1].trim()
    }
    if (!item.text) continue
    out.push(item)
  }
  return out
}

/**
 * classes.txt：`星期<TAB>开始<TAB>结束<TAB>课名[<TAB>起周<TAB>止周<TAB>单双周]`
 * 第 5–7 段可选：0 = 每周，1 = 单周，2 = 双周。
 */
export function parseClasses(text) {
  const out = []
  for (const line of lines(text)) {
    const p = line.split('\t')
    if (p.length < 4) continue
    const day = Number.parseInt(p[0].trim(), 10)
    const start = toMin(p[1])
    const end = toMin(p[2])
    const name = p[3].trim()
    if (!(day >= 1 && day <= 7) || start < 0 || !name) continue
    const cls = { day, start, end: end > start ? end : start + 45, name, weekFrom: 1, weekTo: 99, parity: 0 }
    if (p.length >= 7) {
      const wf = Number.parseInt(p[4].trim(), 10)
      const wt = Number.parseInt(p[5].trim(), 10)
      const par = Number.parseInt(p[6].trim(), 10)
      if (Number.isFinite(wf)) cls.weekFrom = wf
      if (Number.isFinite(wt)) cls.weekTo = wt
      if (par === 1 || par === 2) cls.parity = par
    }
    out.push(cls)
  }
  return out
}

/** events.txt：`日期<TAB>开始<TAB>结束<TAB>类型<TAB>名称[<TAB>分类]` */
export function parseEvents(text) {
  const out = []
  for (const line of lines(text)) {
    const p = line.split('\t')
    if (p.length < 5) continue
    const date = String(p[0]).trim()
    const start = toMin(p[1])
    const end = toMin(p[2])
    const name = p[4].trim()
    if (!parseYmd(date) || start < 0 || !name) continue
    out.push({
      date,
      start,
      end: end > start ? end : start + 30,
      kind: p[3].trim(),
      name,
      cat: normCat(p[5]),
    })
  }
  return out
}

/** cfg.txt：`key=value` 一行一对（小窗自己读写，这里只关心 semesterstart）。 */
export function parseCfg(text) {
  const out = {}
  for (const line of lines(text)) {
    const at = line.indexOf('=')
    if (at <= 0) continue
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

/** 开学日期起算的第几周（和小窗本体 WeekOf 同一算法），0 = 还没开学/不会算。 */
export function weekOf(date, semesterStart) {
  const start = parseYmd(semesterStart)
  if (!start) return 0
  const days = Math.floor((startOfDay(date) - start) / 86_400_000)
  return days < 0 ? 0 : Math.floor(days / 7) + 1
}

function inWeek(cls, week) {
  if (week <= 0) return true
  if (week < cls.weekFrom || week > cls.weekTo) return false
  if (cls.parity === 1 && week % 2 === 0) return false
  if (cls.parity === 2 && week % 2 === 1) return false
  return true
}

// ---------------------------------------------------------------- 格式化 ---

const hm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`

/** 'YYYY-MM-DD HH:mm'（或只有日期）→ 当天 0 点 + 分钟；解析不了返回 null。 */
function dueOf(item) {
  const m = /^(\d{4}-\d{1,2}-\d{1,2})(?:\s+(\d{1,2}:\d{2}))?$/.exec(String(item.due || '').trim())
  if (!m) return null
  const day = parseYmd(m[1])
  if (!day) return null
  const min = m[2] ? toMin(m[2]) : 0
  return { day, min: min >= 0 ? min : 0, text: m[2] || '' }
}

function catTag(cat) {
  return cat === '重要' ? ' [重要]' : cat === '特殊' ? ' [特殊]' : ''
}

function dayLabel(date, offset) {
  const near = offset === 0 ? '今天' : offset === 1 ? '明天' : offset === 2 ? '后天' : ''
  const stamp = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${WEEKDAY[date.getDay()]}`
  return near ? `${near} ${stamp}` : stamp
}

/** 截止时间的手机写法：近三天用"今天/明天/后天"，跨年补年份。 */
function dueLabel(due, today) {
  const diff = Math.round((startOfDay(due.day) - startOfDay(today)) / 86_400_000)
  const time = due.text ? ` ${due.text}` : ''
  if (diff === 0) return `今天${time}`
  if (diff === 1) return `明天${time}`
  if (diff === 2) return `后天${time}`
  if (diff === -1) return `昨天${time}`
  const sameYear = due.day.getFullYear() === today.getFullYear()
  const day = sameYear
    ? `${pad2(due.day.getMonth() + 1)}-${pad2(due.day.getDate())}`
    : ymd(due.day)
  return `${day}${time}`
}

// ---------------------------------------------------------------- 装配 ---

/**
 * @param {object} deps
 * @param {object} deps.cfg      resolveConfig 之后的 cfg（要 cfg.todoAppDir）
 * @param {object} deps.log
 */
export function createSchedule({ cfg, log }) {
  const dir = String(cfg?.todoAppDir || '').trim()

  async function readFileOr(file, fallback = '') {
    try {
      return await readFile(path.join(dir, file), 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        log?.warn?.(`schedule: 读不动 ${file}：${error instanceof Error ? error.message : String(error)}`)
      }
      return fallback
    }
  }

  /** 一次读完四份数据（都不大，几 KB）。 */
  async function loadApp() {
    const [todosText, classesText, eventsText, cfgText] = await Promise.all([
      readFileOr('todos.txt'),
      readFileOr('classes.txt'),
      readFileOr('events.txt'),
      readFileOr('cfg.txt'),
    ])
    const appCfg = parseCfg(cfgText)
    return {
      todos: parseTodos(todosText),
      classes: parseClasses(classesText),
      events: parseEvents(eventsText),
      semesterStart: appCfg.semesterstart || '',
      empty: !todosText.trim() && !classesText.trim() && !eventsText.trim(),
    }
  }

  function missingHint() {
    return `没配待办目录（config 的 todoAppDir），日程和待办读不到。`
  }

  /**
   * `/日程 [天数|明天|后天|本周|下周]`：从今天起的安排，课表 + 一次性事务 + 当天截止。
   * 默认 7 天（今天 + 6 天）。
   */
  async function scheduleSnapshot(argument = '') {
    if (!dir) return missingHint()
    const app = await loadApp()
    if (app.empty) return `待办小窗里还没有数据（${dir}）。`

    const today = startOfDay(new Date())
    const wd = (today.getDay() + 6) % 7 // 0 = 周一 … 6 = 周日
    const arg = String(argument || '').trim()
    let from = 0
    let days = Number(cfg?.scheduleDays) > 0 ? Number(cfg.scheduleDays) : 7
    if (/^(本周|这周)$/.test(arg)) days = 7 - wd
    else if (/^下周$/.test(arg)) {
      from = 7 - wd
      days = 7
    } else if (/^今天$/.test(arg)) days = 1
    else if (/^明天$/.test(arg)) {
      from = 1
      days = 1
    } else if (/^后天$/.test(arg)) {
      from = 2
      days = 1
    } else if (/^\d{1,2}$/.test(arg)) days = Math.min(Math.max(Number(arg), 1), 14)
    days = Math.min(Math.max(days, 1), 31)

    const first = addDays(today, from)
    const last = addDays(first, days - 1)
    const weekStart = weekOf(first, app.semesterStart)
    const weekText = weekStart > 0 ? ` · 第 ${weekStart} 周` : ''
    const head = days === 1
      ? `【日程】${dayLabel(first, from)}`
      : `【日程】${pad2(first.getMonth() + 1)}-${pad2(first.getDate())} → ${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}（${days} 天）`

    // 未完成、且有截止时间的待办，按"截止日"挂到对应那天的下面。
    const pending = []
    for (const item of app.todos) {
      if (item.done) continue
      const due = dueOf(item)
      if (due) pending.push({ item, due })
    }

    const linesOut = [`${head}${weekText}`, '']
    let classCount = 0
    let eventCount = 0
    let dueCount = 0
    for (let i = 0; i < days; i += 1) {
      const day = addDays(first, i)
      const key = ymd(day)
      const dow = day.getDay() === 0 ? 7 : day.getDay() // 1 = 周一
      const week = weekOf(day, app.semesterStart)
      const entries = []
      for (const cls of app.classes) {
        if (cls.day !== dow || !inWeek(cls, week)) continue
        entries.push({ at: cls.start, line: `${hm(cls.start)}-${hm(cls.end)} ${clip(cls.name, NAME_MAX)}` })
        classCount += 1
      }
      for (const ev of app.events) {
        if (ev.date !== key) continue
        const kind = ev.kind ? `${ev.kind}｜` : ''
        entries.push({
          at: ev.start,
          line: `${hm(ev.start)}-${hm(ev.end)} ${kind}${clip(ev.name, NAME_MAX)}${catTag(ev.cat)}`,
        })
        eventCount += 1
      }
      for (const { item, due } of pending) {
        if (ymd(due.day) !== key) continue
        const prio = item.prio ? `（${item.prio}）` : ''
        entries.push({
          at: due.min,
          line: `${due.text || '全天'} 截止 ${clip(item.text, TEXT_MAX)}${prio}`,
        })
        dueCount += 1
      }
      entries.sort((a, b) => a.at - b.at)
      // 只查一天时标题里已经写了「明天 11-20 周五」，这里不再重复。
      if (days > 1) linesOut.push(dayLabel(day, from + i))
      if (entries.length === 0) linesOut.push('· （空）')
      for (const entry of entries) linesOut.push(`· ${entry.line}`)
      linesOut.push('')
    }
    // 没排上的（截止日在这段时间之外）不列，但要说一句，免得以为漏了。
    const overdue = pending.filter(({ due }) => startOfDay(due.day) < today).length
    linesOut.push(
      `共 ${classCount} 节课、${eventCount} 个安排、${dueCount} 条截止` +
        (overdue > 0 ? `；另有 ${overdue} 条已过期（/待办）` : ''),
    )
    // 只有默认视图才提"还能怎么看"，单日查询后面跟一行提示只是噪音。
    if (days >= 7) linesOut.push(`看更久：/日程 14 · 只看本周：/日程 本周`)
    return linesOut.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  /**
   * `/待办 [全部]`：未完成的清单，按"截止时间 → 紧要程度"排。
   * 截止时间只有小时的也算当天（小窗里就是这么记的）。
   */
  async function todoSnapshot(argument = '') {
    if (!dir) return missingHint()
    const app = await loadApp()
    if (app.empty) return `待办小窗里还没有数据（${dir}）。`
    const showAll = /^(全部|all|done)$/i.test(String(argument || '').trim())
    const today = startOfDay(new Date())
    const now = Date.now()

    const rows = app.todos
      .map((item) => ({ item, due: dueOf(item) }))
      .filter(({ item }) => showAll || !item.done)
      .sort((a, b) => {
        const am = a.due ? a.due.day.getTime() + a.due.min * 60_000 : Number.MAX_SAFE_INTEGER
        const bm = b.due ? b.due.day.getTime() + b.due.min * 60_000 : Number.MAX_SAFE_INTEGER
        if (am !== bm) return am - bm
        const ap = PRIO_ORDER.indexOf(a.item.prio || 'Z')
        const bp = PRIO_ORDER.indexOf(b.item.prio || 'Z')
        if (ap !== bp) return ap - bp
        return a.item.text.localeCompare(b.item.text, 'zh')
      })

    const doneTotal = app.todos.filter((item) => item.done).length
    const open = rows.filter(({ item }) => !item.done)
    const overdue = open.filter(({ due }) => due && due.day.getTime() + due.min * 60_000 < now).length
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)
    const head = showAll
      ? `【待办】全部 ${rows.length} 条（已完成 ${doneTotal}）`
      : `【待办】${open.length} 条未完${doneTotal > 0 ? `（已完成 ${doneTotal}）` : ''}`
    const out = [`${head} ${stamp}`, '']
    if (rows.length === 0) {
      out.push('清单是空的。加一条：py todo.py add "要干的事" --due "2026-11-21 09:00"')
      return out.join('\n').trim()
    }
    rows.forEach(({ item, due }, index) => {
      const bits = []
      if (item.done) bits.push('[x]')
      if (item.prio) bits.push(`[${item.prio}]`)
      if (due) {
        const late = !item.done && due.day.getTime() + due.min * 60_000 < now
        bits.push(`${late ? '过期 ' : ''}${dueLabel(due, today)}`)
      }
      if (item.min) bits.push(`${item.min}分`)
      out.push(`${index + 1}. ${bits.length ? `${bits.join(' ')} ` : ''}${item.text}`)
    })
    out.push('')
    out.push(
      overdue > 0
        ? `其中 ${overdue} 条已过期。勾完的归档：py todo.py archive`
        : '勾完的归档：py todo.py archive',
    )
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  return { scheduleSnapshot, todoSnapshot, loadApp }
}
