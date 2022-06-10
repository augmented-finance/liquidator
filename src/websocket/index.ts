import { Plugin, Server } from '@hapi/hapi'
import * as Nes from '@hapi/nes'
import * as pkg from '../../package.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WebsocketOptions = Record<string, any>

export const Websocket: Plugin<WebsocketOptions> = {
  name: 'websocket',
  version: pkg.version,
  register: async (server: Server, options: WebsocketOptions) => {
    await server.register({
      plugin: Nes,
      options: {
        ...options
      }
    })

    /* TODO: add ws subscriptions here */
    await server.subscription('/example', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter: (path: string, message: any, options: any) => true
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.method('send', (data: any, path: string | '*') => {
      if (path === '*') {
        server.broadcast(data)
        return
      }

      server.publish(path, data)
    })
  }
}
