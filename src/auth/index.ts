import { Plugin, Server } from '@hapi/hapi'
import * as basic from './basic'
import * as bearer from './jwt'
import * as pkg from '../../package.json'
import * as HapiBearer from 'hapi-auth-bearer-token'
import * as HapiBasic from '@hapi/basic'

export type AuthOptions = {
  // TODO: add additional options that needs to be passed to this module
  jwtTokenSecret: string
  jwtRefreshTokenSecret: string
  jwtTokenLifetime: string | number
  jwtRefreshTokenLifetime: string | number
}

export const Auth: Plugin<AuthOptions> = {
  name: 'auth',
  version: pkg.version,
  register: async (server: Server, options: AuthOptions) => {
    await server.register([
      HapiBearer,
      HapiBasic
    ])

    server.auth.strategy('bearer', 'bearer-access-token', {
      validate: bearer.validateToken
    })

    server.auth.strategy('bearer-refresh', 'bearer-access-token', {
      validate: bearer.validateRefreshToken
    })

    server.auth.strategy('basic', 'basic', {
      validate: basic.validate
    })

    server.expose('jwtTokenSecret', options.jwtTokenSecret)
    server.expose('jwtRefreshTokenSecret', options.jwtRefreshTokenSecret)

    server.expose('jwtTokenLifetime', options.jwtTokenLifetime)
    server.expose('jwtRefreshTokenLifetime', options.jwtRefreshTokenLifetime)

    server.method(bearer.createToken.name, bearer.createToken)
    server.method(bearer.verifyToken.name, bearer.verifyToken)
  }
}
