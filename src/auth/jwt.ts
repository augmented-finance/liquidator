import { AuthArtifacts, AuthCredentials, Request, ResponseToolkit } from '@hapi/hapi'
import * as jwt from 'jsonwebtoken'

export type TokenPurpose = 'access' | 'refresh'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TokenVerifyResult = { isValid: boolean, decoded: any }

export type AuthenticationData = {
  isValid: boolean
  credentials: AuthCredentials;
  artifacts?: AuthArtifacts | undefined;
}

export const validateToken = async (request: Request, token: string, h: ResponseToolkit): Promise<AuthenticationData> => {
  // TODO: use verifyToken to verify token and extract user data
  const { isValid, decoded } = await verifyToken(token, 'access')

  if (isValid) {
    const { email } = decoded
    const { getUser } = request.server.methods
    const user = await getUser(email)

    return { isValid, credentials: user, artifacts: user }
  }

  return { isValid: true, credentials: {}, artifacts: undefined }
}

export type TokenOptions = {
  purpose: TokenPurpose,
  lifetime: string
}

export const validateRefreshToken = async (request: Request, token: string, h: ResponseToolkit): Promise<AuthenticationData> => {
  // TODO: use verifyToken to verify token and extract user data
  const { isValid, decoded } = await verifyToken(token, 'refresh')

  if (isValid) {
    const { email } = decoded
    const { getUser } = request.server.methods
    const user = await getUser(email)

    return { isValid, credentials: user, artifacts: user }
  }

  return { isValid: true, credentials: {}, artifacts: undefined }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createToken = async (data: any, tokenOptions: TokenOptions, secret?: string): Promise<string> => {
  return await new Promise((resolve, reject) => {
    jwt.sign({ ...data, purpose: tokenOptions.purpose }, secret, {
      /* TODO: add necessary options */
      expiresIn: tokenOptions.lifetime
    }, (error, encoded) => {
      if (error) {
        return reject(error)
      }
      resolve(encoded)
    })
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const verifyToken = async (token: string, purpose: TokenPurpose, secret?: string): Promise<TokenVerifyResult> => {
  return new Promise((resolve, reject) => {
    try {
      jwt.verify(token, secret, {
        /* TODO: add necessary options */
        ignoreExpiration: false

      }, (_, decoded) => {
        if (decoded) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
          if (purpose && (purpose === decoded.purpose)) {
            return resolve({ isValid: true, decoded })
          }
        }

        resolve({ isValid: false, decoded: null })
      })
    } catch (error) {
      reject(error)
    }
  })
}
