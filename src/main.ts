import * as dotenv from 'dotenv'
dotenv.config()

// eslint-disable-next-line import/first
import * as main from './server'

;(async function (): Promise<void> {
  try {
    const server = await main.createServer()

    // Запускаем сервер
    await server.start()
  } catch (e) {
    console.error(e)
  }
})()
