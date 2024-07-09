import { Context, Dict, Schema, Time, Universal } from 'koishi'

export class Ping {
  static name = 'ping'

  botsTime: Dict<number>
  botsRetry: Dict<number>
  curfew: Ping.TimeRange[]

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
            && (!this.botsTime[bot.sid] || Date.now() - this.botsTime[bot.sid] > config.reloadAdapters.intervals?.[bot.sid])) {
            this.botsRetry[bot.sid] = (this.botsRetry[bot.sid] ?? 0) + 1
            ctx.logger.info(`${bot.sid} not responding, check`)
            if (this.botsRetry[bot.sid] > config.reloadAdapters.retries) {
              ctx.logger.info(`${bot.sid} not responding, reload`)
              this.botsRetry[bot.sid] = 0
              bot.ctx.scope.update(bot.ctx.config, true)
            }
          }
        })
      }, config.reloadAdapters.checkInterval)
    }

    config.ping && ctx.command('ping', { authority: 3 }).action(() => 'pong')

    ctx.on('bot-status-updated', async (client) => {
      if (client.platform.startsWith('sandbox:')) return
      if (client.status === Universal.Status.ONLINE) return
      if (client.sid !== config.notifySid) {
        const bot = ctx.bots[config.notifySid]
        if (bot) await bot.sendMessage(config.notifyTarget, `Bot <${client.sid}> Offline`)
      }
      if (config.reloadOnDisconnect) {
        ctx.logger.info(`${client.sid} disconnected, reload after ${config.reloadOnDisconnectDelay} ms`)
        const sid = client.sid
        ctx.setTimeout(() => {
          const bot = ctx.bots[sid]
          if (!bot || bot.status === Universal.Status.ONLINE) return
          ctx.logger.info(`${client.sid} disconnected, try reloading`)
          bot.ctx.scope.update(bot.ctx.config, true)
        }, config.reloadOnDisconnectDelay)
      }
    })
  }
}

export namespace Ping {
  export const reusable = true

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
    ping: boolean
    notifySid: string
    notifyTarget: string
    reloadOnDisconnect: boolean
    reloadOnDisconnectDelay: number
    reloadAdapters: ReloadAdaptersConfig
    curfew: MarkerTimeRange[]
  }

  export const Config: Schema<Config> = Schema.object({
    ping: Schema.boolean().default(true),
    notifySid: Schema.string(),
    notifyTarget: Schema.string(),
    reloadOnDisconnect: Schema.boolean().default(false),
    reloadOnDisconnectDelay: Schema.natural().role('ms').default(5 * Time.minute),
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
