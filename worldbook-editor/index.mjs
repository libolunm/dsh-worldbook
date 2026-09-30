import { readFile, writeFile, rename, unlink, open } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const name = 'worldbook-editor'
export const inject = ['webServer']
const HTML = fileURLToPath(new URL('./editor.html', import.meta.url))
const DEFAULT_BOOK = join(homedir(), '.dsh', '.agent-presets', 'tavern', 'worldbook.json')
/** Path resolution matches the engine plugin: patch `config.path`, then the env
 * var, then the default preset location. Relative paths resolve against cwd.
 */
function resolveBook(config) {
  const configured = config?.path || process.env.DSH_WORLDBOOK_PATH || DEFAULT_BOOK
  return isAbsolute(configured) ? configured : resolve(configured)
}
// Rebound in apply() once the loader hands over the entry config.
let BOOK = DEFAULT_BOOK
const MAX_BYTES = 1024 * 1024
const hash = text => createHash('sha256').update(text).digest('hex')

function validate(book) {
  if (!book || typeof book !== 'object' || Array.isArray(book) || !Array.isArray(book.entries)) throw new Error('世界书必须包含 entries 数组')
  const seen = new Set()
  for (const item of book.entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('条目必须是对象')
    if (typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)) throw new Error('条目 id 必须非空且唯一')
    seen.add(item.id)
    if (typeof item.content !== 'string' || !item.content.trim()) throw new Error('条目正文不能为空')
    if (item.title !== undefined && typeof item.title !== 'string') throw new Error('标题必须是文本')
    for (const key of ['constant', 'enabled', 'caseSensitive']) if (item[key] !== undefined && typeof item[key] !== 'boolean') throw new Error(key + ' 必须是布尔值')
    if (item.keys !== undefined && (!Array.isArray(item.keys) || item.keys.some(k => typeof k !== 'string'))) throw new Error('keys 必须是文本数组')
    if (item.repeat !== undefined && !['once', 'always'].includes(item.repeat)) throw new Error('repeat 必须是 once 或 always')
  }
}
function json(res, status, value) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
  res.end(JSON.stringify(value))
}
async function snapshot() {
  const raw = await readFile(BOOK, 'utf8')
  const book = JSON.parse(raw)
  validate(book)
  return {raw, book, revision: hash(raw)}
}
async function body(req) {
  const parts = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BYTES) { const e = new Error('请求体超过 1 MiB'); e.status = 413; throw e }
    parts.push(chunk)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}
function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin || req.headers['sec-fetch-site'] === 'cross-site') return false
  try {
    const actual = new URL(origin)
    return actual.protocol === 'http:' && actual.host === req.headers.host
  } catch { return false }
}

export function apply(ctx, config = {}) {
  BOOK = resolveBook(config)
  let writes = Promise.resolve()
  ctx.effect(() => ctx.webServer.register({kind: 'exact', path: '/worldbook', handler: async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {Allow:'GET, HEAD'}); res.end(); return }
    try {
      const html = await readFile(HTML, 'utf8')
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'"})
      res.end(req.method === 'HEAD' ? undefined : html)
    } catch (error) { json(res, 500, {error: error.message}) }
  }}))
  ctx.effect(() => ctx.webServer.register({kind: 'exact', path: '/worldbook/api', handler: async (req, res) => {
    try {
      if (req.method === 'GET') { const {book, revision} = await snapshot(); json(res, 200, {book, revision}); return }
      if (req.method !== 'PUT') { res.writeHead(405, {Allow:'GET, PUT'}); res.end(); return }
      if (!sameOrigin(req)) { json(res, 403, {error:'仅允许同源页面保存世界书'}); return }
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { json(res, 415, {error:'需要 application/json'}); return }
      const input = await body(req)
      validate(input.book)
      if (typeof input.revision !== 'string') { json(res, 400, {error:'缺少 revision'}); return }
      const operation = writes.then(async () => {
        const current = await snapshot()
        if (current.revision !== input.revision) { json(res, 409, {error:'文件已被其他页面或 Agent 修改，请重新加载后再保存', revision:current.revision}); return }
        const raw = JSON.stringify(input.book, null, 2) + '\n'
        if (Buffer.byteLength(raw) > MAX_BYTES) { json(res, 413, {error:'世界书超过 1 MiB'}); return }
        const lockPath = BOOK + '.lock'
        let lock
        try {
          lock = await open(lockPath, 'wx')
        } catch (error) {
          if (error.code === 'EEXIST') { json(res, 409, {error:'世界书正被 Agent 或其他页面写入，请重新读取后再保存'}); return }
          throw error
        }
        const temp = BOOK + '.' + randomUUID() + '.tmp'
        try {
          // Re-read after acquiring the shared engine lock.
          const lockedCurrent = await snapshot()
          if (lockedCurrent.revision !== input.revision) { json(res,409,{error:'文件已被其他页面或 Agent 修改，请重新加载后再保存', revision:lockedCurrent.revision}); return }
          await writeFile(BOOK + '.bak', lockedCurrent.raw, 'utf8')
          await writeFile(temp, raw, {encoding:'utf8',flag:'wx'})
          // Recheck after backup/temp writes so outside file writers are detected too.
          if ((await snapshot()).revision !== lockedCurrent.revision) { json(res,409,{error:'保存期间文件发生变化，请重新加载'}); return }
          await rename(temp, BOOK)
          json(res,200,{book:input.book,revision:hash(raw)})
        } finally {
          await unlink(temp).catch(() => {})
          await lock.close()
          await unlink(lockPath).catch(() => {})
        }
      })
      writes = operation.catch(() => {})
      await operation
    } catch (error) { if (!res.headersSent) json(res,error.status || 400,{error:error.message}); else res.end() }
  }}))
}
