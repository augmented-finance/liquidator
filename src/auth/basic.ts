import { Request, ResponseToolkit } from '@hapi/hapi'
import * as bcrypt from 'bcrypt'

type AuthResult = {
  isValid: boolean
  /* eslint-disable @typescript-eslint/no-explicit-any */
  credentials: any,
  artifacts: any
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export const validate = async (request: Request, username: string, password: string, context: ResponseToolkit): Promise<AuthResult> => {
  const hashedPassword = await bcrypt.hash(password, 1)

  const user = await request.server.methods.getUser(username, hashedPassword)
  if (user) {
    const { id, email } = user
    return { isValid: true, credentials: { id, email }, artifacts: user }
  }

  return { isValid: false, credentials: null, artifacts: null }
}
