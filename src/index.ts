import { Context, Dict, Logger, Schema, Time } from 'koishi'

const logger = new Logger('ping')
const kRecord = Symbol.for('koishi.loader.record')

export class Ping {
  botsTime: Dict<number>
  botsRetry: Dict<number>
  curfew: Ping.TimeRange[]

  _findPlugin(name: string, parent: Context): [string, Context, Context] {
    if (!parent) return
    const reg = parent.scope[kRecord]
    if (!reg) return
    for (const key of Object.getOwnPropertyNames(reg)) {
      const i1 = key.indexOf('/'), i2 = key.indexOf(':')
      const mkey = key.slice(0, i2 === i1 ? key.length : i2)
      if (mkey === name) return [key, parent, reg[key]?.ctx]
      const res = this._findPlugin(name, reg[key]?.ctx)
      if (res) return res
    }
  }

  _findPluginC(plugin: Context, parent: Context): [string, Context, Context] {
    if (!parent) return
    const reg = parent.scope[kRecord]
    if (!reg) return
    for (const key of Object.getOwnPropertyNames(reg)) {
      if (reg[key]?.ctx === plugin) return [key, parent, reg[key]?.ctx]
      const res = this._findPluginC(plugin, reg[key]?.ctx)
      if (res) return res
    }
  }

  findPlugin(plugin: string | Context) {
    if (typeof plugin === 'string') {
      return this._findPlugin(plugin, this.ctx.loader.entry)
    } else {
      return this._findPluginC(plugin, this.ctx.loader.entry)
    }
  }

  async reloadPlugin(plugin: string | Context) {
    const [key, parent] = this.findPlugin(plugin) ?? []
    if (!key) return 'Not found'
    this.ctx.loader.unloadPlugin(parent, key)
    await this.ctx.loader.reloadPlugin(parent, key, parent.config[key])
  }

  checkCurfew() {
    const date = new Date()
    const time = date.getHours() * 60 + date.getMinutes()
    for (const { start, end } of this.curfew) {
      if (time > start && time < end) return true
    }
  }

  constructor(public ctx: Context, public config: Ping.Config) {
    this.botsTime = {}
    this.botsRetry = {}

    this.curfew = (config.curfew || []).map(({ start, end }) => {
      return {
        start: Ping.markerTimeToNumber(start),
        end: Ping.markerTimeToNumber(end),
      }
    })

    ctx.middleware((session, next) => {
      this.botsTime[session.sid] = Date.now()
      this.botsRetry[session.sid] = 0
      return next()
    })

    if (config.reloadAdapters.checkInterval) {
      ctx.setInterval(() => {
        if (this.checkCurfew()) return
        ctx.bots.forEach(bot => {
          if (config.reloadAdapters.intervals?.[bot.sid]
            && this.botsTime[bot.sid]
            && (Date.now() - this.botsTime[bot.sid] > config.reloadAdapters.intervals?.[bot.sid])) {
            this.botsRetry[bot.sid]++
            ctx.logger('ping').info(`${bot.sid} not responding, check`)
            if (this.botsRetry[bot.sid] > config.reloadAdapters.retries) {
              ctx.logger('ping').info(`${bot.sid} not responding, reload`)
              this.botsRetry[bot.sid] = 0
              this.reloadPlugin(bot.ctx).catch(logger.error)
            }
          }
        })
      }, config.reloadAdapters.checkInterval)
    }

    ctx.command('ping', { authority: 3 }).action(() => 'pong')

    ctx.on('bot-disconnect', async (client) => {
      if (client.sid !== config.notifySid) {
        const bot = ctx.bots[config.notifySid]
        if (bot) await bot.sendMessage(config.notifyTarget, `Bot <${client.sid}> Offline`)
      }
    })
  }
}

export namespace Ping {

  type SingleNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  type MarkerTime = `${SingleNumber | ''}${SingleNumber}:${SingleNumber}${SingleNumber}`

  export function markerTimeToNumber(marker: MarkerTime) {
    const [hours, minutes] = marker.split(':')
    return parseInt(hours) * 60 + parseInt(minutes)
  }

  export interface TimeRange {
    start: number
    end: number
  }

  export interface MarkerTimeRange {
    start: MarkerTime
    end: MarkerTime
  }

  export interface ReloadAdaptersConfig {
    retries: number
    checkInterval: number
    intervals?: Dict<number>
  }

  export interface Config {
    notifySid: string
    notifyTarget: string
    reloadAdapters: ReloadAdaptersConfig
    curfew: MarkerTimeRange[]
  }

  export const Config: Schema<Config> = Schema.object({
    notifySid: Schema.string(),
    notifyTarget: Schema.string(),
    reloadAdapters: Schema.object({
      retries: Schema.natural().default(2).description('Max retries before reloading'),
      checkInterval: Schema.natural().role('ms').default(2 * Time.minute),
      intervals: Schema.dict(Schema.natural().role('ms')).description('Intervals as offline'),
    }).description('ReloadAdapters'),
    curfew: Schema.array(Schema.object<MarkerTimeRange>({
      start: Schema.string().pattern(/\d{1,2}:\d{1,2}/) as any,
      end: Schema.string().pattern(/\d{1,2}:\d{1,2}/) as any,
    })).role('table'),
  })
}

export default Ping
