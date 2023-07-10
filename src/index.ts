import { Context, Dict, Schema, Loader } from 'koishi'
import { } from 'koishi-plugin-cron'

export class Ping {
  static using = ['cron']
  botsTime: Dict<number>
  botsRetry: Dict<number>

  _findPlugin(name: string, parent: Context): [string, Context, Context] {
    if (!parent) return
    const reg = parent.scope[Loader.kRecord]
    if (!reg) return
    for (const key of Object.getOwnPropertyNames(reg)) {
      const i1 = key.indexOf('/'), i2 = key.indexOf(':')
      const mkey = key.slice(0, i2 === i1 ? key.length: i2)
      // console.log(mkey)
      // if (mkey === 'group') continue
      if (mkey === name) return [key, parent, reg[key]?.ctx]
      // console.log(reg[key]?.ctx)
      const res = this._findPlugin(name, reg[key]?.ctx)
      if (res) return res
    }
  }

  _findPluginC(plugin: Context, parent: Context): [string, Context, Context] {
    if (!parent) return
    const reg = parent.scope[Loader.kRecord]
    if (!reg) return
    for (const key of Object.getOwnPropertyNames(reg)) {
      if (reg[key]?.ctx === plugin) return [key, parent, reg[key]?.ctx]
      const res = this._findPluginC(plugin, reg[key]?.ctx)
      if (res) return res
    }
  }

  findPlugin(plugin: string | Context) {
    if (typeof plugin === 'string')
      return this._findPlugin(plugin, this.ctx.loader.entry)
    else
      return this._findPluginC(plugin, this.ctx.loader.entry)
  }

  async reloadPlugin(plugin: string | Context) {
    const [key, parent, _] = this.findPlugin(plugin)??[]
    if (!key) return 'Not found'
    this.ctx.loader.unloadPlugin(parent, key)
    await this.ctx.loader.reloadPlugin(parent, key, parent.config)
  }

  constructor(public ctx: Context, public config: Ping.Config) {
    this.botsTime = {}
    this.botsRetry = {}
  
    ctx.middleware((session, next) => {
      this.botsTime[session.sid] = Date.now()
      this.botsRetry[session.sid] = 0
      return next()
    })
    
    ctx.cron(`*/${config.reloadAdapterCheckInterval} * * * *`, () => {
      ctx.bots.forEach(bot => {
        if (config.reloadAdapterIntervals?.[bot.sid]
          && this.botsTime[bot.sid]
          && (Date.now() - this.botsTime[bot.sid] > 1000 * config.reloadAdapterIntervals?.[bot.sid])) {
            this.botsRetry[bot.sid] ++
            ctx.logger('ping').info(`${bot.sid} not responding, check`)
            if (this.botsRetry[bot.sid] >= 2) {
              ctx.logger('ping').info(`${bot.sid} not responding, reload`)
              this.reloadPlugin(bot.ctx)
            }
        }
      })
    })
  
    ctx.command('bots', { authority: 4 }).action(({ session }) => {
      console.log(ctx.bots[0].ctx)
      console.log(this.findPlugin(ctx.bots[0].ctx))
    })
  
    ctx.command('ping', { authority: 3 }).action(() => 'pong')
  
    ctx.on('bot-disconnect', async (client) => {
      if (client.sid != config.notifySid) {
        const bot = ctx.bots[config.notifySid]
        if (bot) await bot.sendMessage(config.notifyTarget, `Bot <${client.sid}> Offline`)
      }
    })
  }
  
}

export namespace Ping {
  export interface Config {
    notifySid: string
    notifyTarget: string
    reloadAdapterCheckInterval: number
    reloadAdapterIntervals?: Dict<number>
  }
  
  export const Config: Schema<Config> = Schema.object({
    notifySid: Schema.string(),
    notifyTarget: Schema.string(),
    reloadAdapterCheckInterval: Schema.number().default(2),
    reloadAdapterIntervals: Schema.dict(Number),
  })
}

export default Ping
