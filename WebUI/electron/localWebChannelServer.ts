import http from 'node:http'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { LOCAL_WEB_CHAT_APP_HTML } from './localWebChatAppHtml.ts'
import { appLoggerInstance } from './logging/logger.ts'

export type LocalWebInboundMessage = {
  text?: string
  chat_id: string
  channel?: string
  ts?: string
  callback?: string
}

type SseClient = {
  res: http.ServerResponse
  clientId: string
}

const LOG = 'local-web-channel'
const SESSION_COOKIE = 'aipg_local_web'

let server: http.Server | null = null
let runningPort = 0
let runningPassword = ''
let allowLan = true
const inbox: LocalWebInboundMessage[] = []
const sseClients = new Set<SseClient>()
const activeSessions = new Set<string>()

function clientIdFromReq(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const ip =
    (typeof forwarded === 'string' ? forwarded.split(',')[0] : req.socket.remoteAddress) ?? 'unknown'
  return ip.trim()
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k) out[k] = decodeURIComponent(rest.join('='))
  }
  return out
}

function isAuthenticated(req: http.IncomingMessage): boolean {
  const session = parseCookies(req)[SESSION_COOKIE]
  return !!session && activeSessions.has(session)
}

function createSession(): string {
  const id = randomBytes(32).toString('hex')
  activeSessions.add(id)
  return id
}

function sessionCookieHeader(sessionId: string): string {
  const maxAge = 60 * 60 * 24 * 7
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

function broadcast(event: Record<string, unknown>): void {
  const data = JSON.stringify(event)
  for (const client of sseClients) {
    try {
      client.res.write(`data: ${data}\n\n`)
    } catch {
      sseClients.delete(client)
    }
  }
}

export function deliverLocalWebOutbound(action: string, payload: Record<string, unknown>): void {
  broadcast({ action, ...payload })
}

export function drainLocalWebInbound(): LocalWebInboundMessage[] {
  const msgs = inbox.slice()
  inbox.length = 0
  return msgs
}

export function getLocalWebLanAddresses(): string[] {
  const out: string[] = ['127.0.0.1', 'localhost']
  const nets = os.networkInterfaces()
  for (const entries of Object.values(nets)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      out.push(entry.address)
    }
  }
  return [...new Set(out)]
}

export function getLocalWebUrls(port: number): string[] {
  return getLocalWebLanAddresses().map((host) => `http://${host}:${port}/`)
}

export function getLocalWebServerStatus(): {
  running: boolean
  port: number
  allowLan: boolean
  urls: string[]
} {
  return {
    running: server !== null,
    port: runningPort,
    allowLan,
    urls: server ? getLocalWebUrls(runningPort) : [],
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function localWebPasswordFromConfig(config: Record<string, string | undefined>): string {
  return (config.password ?? config.accessToken ?? '').trim()
}

export async function startLocalWebChannelServer(options: {
  port: number
  password: string
  allowLan: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await stopLocalWebChannelServer()
  runningPassword = options.password
  allowLan = options.allowLan
  runningPort = options.port

  return new Promise((resolve) => {
    const host = options.allowLan ? '0.0.0.0' : '127.0.0.1'
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(LOCAL_WEB_CHAT_APP_HTML)
          return
        }

        if (req.method === 'GET' && url.pathname === '/api/session') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: isAuthenticated(req) }))
          return
        }

        if (req.method === 'POST' && url.pathname === '/api/login') {
          const raw = await readBody(req)
          const body = raw ? (JSON.parse(raw) as { password?: string }) : {}
          if (!body.password || body.password !== runningPassword) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'invalid_password' }))
            return
          }
          const session = createSession()
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': sessionCookieHeader(session),
          })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        if (req.method === 'POST' && url.pathname === '/api/logout') {
          const session = parseCookies(req)[SESSION_COOKIE]
          if (session) activeSessions.delete(session)
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': clearSessionCookieHeader(),
          })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        if (req.method === 'GET' && url.pathname === '/api/events') {
          if (!isAuthenticated(req)) {
            res.writeHead(401)
            res.end()
            return
          }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          })
          const client: SseClient = { res, clientId: clientIdFromReq(req) }
          sseClients.add(client)
          req.on('close', () => sseClients.delete(client))
          res.write(': connected\n\n')
          return
        }

        if (req.method === 'POST' && url.pathname === '/api/chat') {
          if (!isAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'unauthorized' }))
            return
          }
          const raw = await readBody(req)
          const body = raw ? (JSON.parse(raw) as { text?: string; callback?: string }) : {}
          const clientId = clientIdFromReq(req)
          const ts = String(Date.now())
          inbox.push({
            text: body.text,
            callback: body.callback,
            chat_id: clientId,
            channel: 'local-web',
            ts,
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        if (req.method === 'GET' && url.pathname === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          return
        }

        res.writeHead(404)
        res.end()
      } catch (e) {
        appLoggerInstance.error(`local-web request failed: ${e}`, LOG, true)
        res.writeHead(500)
        res.end()
      }
    })
    server.on('error', (err) => {
      appLoggerInstance.error(`local-web server error: ${err}`, LOG, true)
      resolve({ ok: false, error: String(err) })
    })
    server.listen(options.port, host, () => {
      appLoggerInstance.info(
        `Local web Home Agent listening on ${host}:${options.port} (allowLan=${options.allowLan})`,
        LOG,
        true,
      )
      resolve({ ok: true })
    })
  })
}

export async function stopLocalWebChannelServer(): Promise<void> {
  for (const client of sseClients) {
    try {
      client.res.end()
    } catch {
      /* ignore */
    }
  }
  sseClients.clear()
  activeSessions.clear()
  inbox.length = 0
  if (!server) return
  await new Promise<void>((resolve) => {
    server?.close(() => resolve())
  })
  server = null
  runningPort = 0
  runningPassword = ''
}

export { localWebPasswordFromConfig }
