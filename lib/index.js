/**
 * Local model worker: keeps a filesystem-local OpenAI-compatible server
 * (LM Studio, Ollama, llama.cpp, or a custom command) loaded only while it is
 * being used.
 *
 * The plugin owns three things:
 * - a start/stop lifecycle driven by a backend preset, so the user never has to
 *   write a command line for a common local server,
 * - an idle timer that unloads the server again (the real memory saver),
 * - a bridge to the model layer: when the server becomes reachable the provider
 *   route is announced as changed, so a model chosen in Settings becomes usable
 *   without restarting DSH.
 *
 * Everything user-specific (paths, ports, commands) lives in the Config, which
 * the client half edits on the Settings page.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import z from '@deepseek-ai/schemastery'

export const name = 'local-model-worker'
export const inject = ['tools', 'webServer']

/** RPC channel the client half talks to (registered as a prefix route). */
export const RPC_CHANNEL = '/local-model-worker'

/** Settings namespace used when the Loader entry id cannot be discovered. */
const FALLBACK_NAMESPACE = 'local-model-worker'

/** How often the readiness poll re-checks the server. */
const POLL_MS = 500

/** Field defaults, shared with the client so an empty field shows its default. */
const DEFAULTS = {
  backend: 'lmstudio',
  provider: 'local',
  baseURL: '',
  apiKey: '',
  model: '',
  modelPath: '',
  port: 0,
  contextSize: 8192,
  startCommand: '',
  stopCommand: '',
  startCwd: '',
  logFile: '',
  startTimeoutMs: 180000,
  stopTimeoutMs: 60000,
  probeTimeoutMs: 2500,
  idleMinutes: 30,
  autoStart: true,
  pill: true,
}

const DESCRIPTIONS = {
  backend: 'Which local server this plugin starts: lmstudio, ollama, llamacpp, or custom.',
  provider: 'Provider route id this server backs, as created in Settings, Models.',
  baseURL: 'OpenAI-compatible base URL of the server. Empty uses the preset address.',
  apiKey: 'Bearer token sent to the server, when it asks for one.',
  model: 'Model id to report as loaded. Empty uses whatever the server lists first.',
  modelPath: 'Model file or model name for llama.cpp (passed to llama-server -m).',
  port: 'Port the preset server listens on. 0 uses the preset default.',
  contextSize: 'Context size handed to llama-server. 0 keeps the server default.',
  startCommand: 'Command line that starts the server (custom backend only).',
  stopCommand: 'Command line that stops the server. Empty kills the launched process tree.',
  startCwd: 'Working directory for the start command.',
  logFile: 'File that receives the server output. Empty discards it.',
  startTimeoutMs: 'How long to wait for the server to answer after starting it.',
  stopTimeoutMs: 'How long to wait for the server to stop answering.',
  probeTimeoutMs: 'Timeout of one readiness check.',
  idleMinutes: 'Unload the server after this many idle minutes. 0 keeps it loaded.',
  autoStart: 'Start the server when a request targets its provider.',
  pill: 'Show the composer button that starts and stops the server.',
}

const config = (key, schema) => schema.default(DEFAULTS[key]).description(DESCRIPTIONS[key]).volatile()

/** Live plugin Config: every field is volatile so Settings edits apply without a reload. */
export const Config = z.object({
  backend: config('backend', z.string()),
  provider: config('provider', z.string()),
  baseURL: config('baseURL', z.string()),
  apiKey: config('apiKey', z.string()),
  model: config('model', z.string()),
  modelPath: config('modelPath', z.string()),
  port: config('port', z.number().min(0).step(1)),
  contextSize: config('contextSize', z.number().min(0).step(1)),
  startCommand: config('startCommand', z.string()),
  stopCommand: config('stopCommand', z.string()),
  startCwd: config('startCwd', z.string()),
  logFile: config('logFile', z.string()),
  startTimeoutMs: config('startTimeoutMs', z.number().min(1000).step(1000)),
  stopTimeoutMs: config('stopTimeoutMs', z.number().min(1000).step(1000)),
  probeTimeoutMs: config('probeTimeoutMs', z.number().min(100).step(100)),
  idleMinutes: config('idleMinutes', z.number().min(0).step(1)),
  autoStart: config('autoStart', z.boolean()),
  pill: config('pill', z.boolean()),
})

/** Thrown for user mistakes; mapped to a `bad-request` RPC error code. */
class BadRequest extends Error {
  constructor(message) {
    super(message)
    this.name = 'BadRequest'
  }
}

/**
 * Quote one command-line argument for the platform shell.
 * Paths with spaces or non-ASCII characters (Chinese directories, OneDrive
 * folders) only survive when they reach the shell quoted.
 * @param value - argument text.
 * @returns the argument, quoted when it contains anything a shell would split.
 */
function quote(value) {
  const text = String(value ?? '')
  if (text.length === 0) return '""'
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * Presets for the servers people run next to DSH. Each preset answers the two
 * questions the plugin cares about: where the server listens, and how to start
 * or stop it. `start` returns an empty string when the preset cannot start the
 * server from the current settings (for example llama.cpp without a model file).
 */
export const BACKENDS = {
  lmstudio: {
    label: 'LM Studio',
    hint: 'Requires the LM Studio CLI (lms) on PATH.',
    baseURL: () => 'http://127.0.0.1:1234/v1',
    start: () => 'lms server start',
    stop: () => 'lms server stop',
    fields: ['baseURL', 'apiKey', 'model'],
  },
  ollama: {
    label: 'Ollama',
    hint: 'Requires the ollama executable on PATH.',
    baseURL: () => 'http://127.0.0.1:11434/v1',
    start: () => 'ollama serve',
    stop: () => '',
    fields: ['baseURL', 'apiKey', 'model'],
  },
  llamacpp: {
    label: 'llama.cpp',
    hint: 'Requires llama-server on PATH and a model file.',
    baseURL: (values) => `http://127.0.0.1:${values.port || 8080}/v1`,
    start: (values) => {
      if (!values.modelPath) return ''
      const args = ['-m', quote(values.modelPath), '--host', '127.0.0.1', '--port', String(values.port || 8080)]
      if (values.contextSize > 0) args.push('--ctx-size', String(values.contextSize))
      return [quote('llama-server'), ...args].join(' ')
    },
    stop: () => '',
    fields: ['modelPath', 'port', 'contextSize', 'baseURL', 'apiKey'],
  },
  custom: {
    label: 'Custom',
    hint: 'Any command line that starts an OpenAI-compatible server.',
    baseURL: (values) => values.baseURL,
    start: (values) => values.startCommand,
    stop: (values) => values.stopCommand,
    fields: ['baseURL', 'apiKey', 'startCommand', 'stopCommand', 'startCwd', 'model'],
  },
}

/**
 * Turn the current settings into the concrete plan for this run.
 * @param values - resolved plugin settings.
 * @returns backend id, base URL, and the resolved command lines.
 */
export function resolvePlan(values) {
  const backend = Object.hasOwn(BACKENDS, values.backend) ? values.backend : DEFAULTS.backend
  const preset = BACKENDS[backend]
  const baseURL = String(values.baseURL || preset.baseURL(values) || '').replace(/\/+$/, '')
  // Hand-written command lines win over the preset: a profile that already points
  // at a launcher script keeps working even when the backend still sits at its
  // default, which is how the settings were meant to be editable outside the GUI.
  const startLine = String(values.startCommand || '').trim() || preset.start(values).trim()
  const stopLine = String(values.stopCommand || '').trim() || preset.stop(values).trim()
  return {
    backend,
    baseURL,
    startLine,
    stopLine,
  }
}

/**
 * Read every model the server advertises, with the context window it reports.
 * @param body - `/v1/models` response.
 * @returns model ids and the context window of the preferred model.
 */
function describeModels(body, preferred) {
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
  const models = list
    .map((entry) => (typeof entry === 'string' ? entry : entry?.id ?? entry?.name ?? entry?.model))
    .filter((id) => typeof id === 'string' && id.length > 0)
  const chosen = models.includes(preferred) ? preferred : models[0]
  const record = list.find((entry) => typeof entry === 'object' && (entry?.id ?? entry?.name ?? entry?.model) === chosen)
  const context = Number(record?.meta?.n_ctx ?? record?.n_ctx ?? record?.context_length ?? record?.max_model_len ?? 0)
  return { models, model: chosen ?? preferred ?? '', contextWindow: Number.isFinite(context) && context > 0 ? context : 0 }
}

/**
 * Long-lived handle around one local model server.
 * All methods read the settings fresh, so a Settings change is visible to the
 * next call and no reload is needed.
 */
class Worker {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.settings = undefined
    this.child = undefined
    this.childExit = undefined
    this.busy = 0
    this.queue = Promise.resolve()
    this.idleTimer = undefined
    this.idleSince = undefined
  }

  /** One setting, unwrapped from its volatile holder. */
  read(field) {
    const holder = this.config?.[field]
    const value = holder && typeof holder.get === 'function' ? holder.get() : holder
    if (value === undefined || value === null || value === '') return DEFAULTS[field]
    return value
  }

  /** Settings that are pure text (trimmed, never the numeric fallback). */
  text(field) {
    const holder = this.config?.[field]
    const value = holder && typeof holder.get === 'function' ? holder.get() : holder
    return typeof value === 'string' ? value.trim() : ''
  }

  get values() {
    return {
      backend: this.read('backend'),
      provider: this.text('provider') || DEFAULTS.provider,
      baseURL: this.text('baseURL'),
      apiKey: this.text('apiKey'),
      model: this.text('model'),
      modelPath: this.text('modelPath'),
      port: this.read('port'),
      contextSize: this.read('contextSize'),
      startCommand: this.text('startCommand'),
      stopCommand: this.text('stopCommand'),
      startCwd: this.text('startCwd'),
      logFile: this.text('logFile'),
      startTimeoutMs: this.read('startTimeoutMs'),
      stopTimeoutMs: this.read('stopTimeoutMs'),
      probeTimeoutMs: this.read('probeTimeoutMs'),
      idleMinutes: this.read('idleMinutes'),
      autoStart: this.read('autoStart') !== false,
      pill: this.read('pill') !== false,
    }
  }

  get plan() {
    return resolvePlan(this.values)
  }

  get configured() {
    return this.plan.startLine.length > 0
  }

  /** Settings namespace of this plugin's profile row. */
  get namespace() {
    const editor = this.ctx.get?.('configEditor')
    if (editor && typeof editor.configuration === 'function') {
      for (const row of editor.configuration()) {
        const fiber = row?.entry?.fiber ?? row?.fiber
        if (fiber === this.ctx.fiber || fiber?.ctx?.fiber === this.ctx.fiber) {
          if (typeof row?.entry?.options?.id === 'string') return row.entry.options.id
        }
      }
    }
    return FALLBACK_NAMESPACE
  }

  /** Ask the server whether it is up, and what it serves. */
  async probe(overrides) {
    const values = { ...this.values, ...(overrides ?? {}) }
    const { baseURL } = resolvePlan(values)
    if (!baseURL) return { healthy: false, models: [], model: '', contextWindow: 0, detail: 'no base URL configured' }
    const headers = {}
    if (values.apiKey) headers.Authorization = `Bearer ${values.apiKey}`
    try {
      const response = await fetch(`${baseURL}/models`, {
        headers,
        signal: AbortSignal.timeout(Math.max(200, Number(values.probeTimeoutMs) || DEFAULTS.probeTimeoutMs)),
      })
      if (response.status === 401 || response.status === 403) {
        return { healthy: true, models: [], model: values.model, contextWindow: 0, detail: 'server answered, credentials rejected' }
      }
      if (!response.ok) return { healthy: false, models: [], model: '', contextWindow: 0, detail: `HTTP ${response.status}` }
      const body = await response.json().catch(() => ({}))
      const described = describeModels(body, values.model)
      return { healthy: true, ...described, detail: described.models.length > 0 ? `${described.models.length} model(s)` : 'server is up' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const offline = /ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|timed out|aborted/i.test(message)
      return { healthy: false, models: [], model: '', contextWindow: 0, detail: offline ? 'not listening' : message }
    }
  }

  /** Probe once and fold the answer into the public status shape. */
  async status() {
    const probe = await this.probe()
    const values = this.values
    return {
      action: 'status',
      running: probe.healthy,
      configured: this.configured,
      backend: this.plan.backend,
      baseURL: this.plan.baseURL,
      provider: values.provider,
      model: probe.model || values.model,
      contextWindow: probe.contextWindow,
      output: probe.detail,
      pill: values.pill,
    }
  }

  /** Serialize start/stop so two clicks cannot race. */
  serial(task) {
    this.busy += 1
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {}).then(() => {
      this.busy -= 1
    })
    return run
  }

  /** Write the server output into the configured log file, when there is one. */
  logTarget() {
    const file = this.text('logFile')
    if (!file) return 'ignore'
    try {
      mkdirSync(dirname(file), { recursive: true })
      const fd = openSync(file, 'a')
      return fd
    } catch {
      return 'ignore'
    }
  }

  /** Start the server and resolve once it answers (or the deadline passes). */
  async startNow(options = {}) {
    const values = this.values
    const plan = this.plan
    if (!plan.startLine) {
      throw new BadRequest(
        plan.backend === 'llamacpp'
          ? 'Set the model file for llama.cpp before starting the server.'
          : 'Fill in the start command before starting the server.',
      )
    }
    const current = await this.probe()
    if (current.healthy) {
      this.armIdle(options.idleMinutes)
      return this.status()
    }

    const log = this.logTarget()
    const stdio = log === 'ignore' ? 'ignore' : ['ignore', log, log]
    const child = spawn(plan.startLine, {
      shell: true,
      cwd: values.startCwd || undefined,
      detached: true,
      windowsHide: true,
      stdio,
    })
    if (typeof log === 'number') closeSync(log)
    this.child = child
    this.childExit = undefined
    child.on('error', (error) => {
      this.childExit = { code: null, message: error instanceof Error ? error.message : String(error) }
    })
    child.on('exit', (code) => {
      this.childExit = { code, message: '' }
      if (this.child === child) this.child = undefined
    })
    child.unref()

    const began = Date.now()
    const deadline = began + Math.max(1000, Number(values.startTimeoutMs) || DEFAULTS.startTimeoutMs)
    let last = current
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      last = await this.probe()
      if (last.healthy) {
        this.armIdle(options.idleMinutes)
        this.announce()
        return { ...(await this.status()), started: true, output: `started in ${Math.round((Date.now() - began) / 100) / 10}s` }
      }
      if (this.childExit && this.childExit.code !== null && this.childExit.code !== 0) {
        throw new BadRequest(`Start command exited with code ${this.childExit.code}${this.childExit.message ? ` (${this.childExit.message})` : ''}.`)
      }
    }
    throw new BadRequest(`The server did not answer within ${Math.round(values.startTimeoutMs / 1000)}s.`)
  }

  /** Stop the server and resolve once it no longer answers. */
  async stopNow() {
    const plan = this.plan
    const values = this.values
    if (plan.stopLine) {
      await this.runShell(plan.stopLine, values.stopTimeoutMs)
    } else if (this.child && typeof this.child.pid === 'number' && !this.child.killed) {
      this.killTree(this.child.pid)
      this.child = undefined
    } else {
      const current = await this.probe()
      if (!current.healthy) return { ...(await this.status()), stopped: true }
      throw new BadRequest('This server was not started by DSH and no stop command is configured.')
    }
    const deadline = Date.now() + Math.max(1000, Number(values.stopTimeoutMs) || DEFAULTS.stopTimeoutMs)
    while (Date.now() < deadline) {
      const current = await this.probe()
      if (!current.healthy) {
        this.clearIdle()
        return { ...(await this.status()), stopped: true }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
    throw new BadRequest(`The server still answers after ${Math.round(values.stopTimeoutMs / 1000)}s.`)
  }

  /** Run one command to completion; children may keep stdio open, so wait for exit. */
  runShell(line, timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = spawn(line, { shell: true, windowsHide: true, stdio: 'ignore' })
      const timer = setTimeout(() => {
        this.killTree(child.pid)
        reject(new BadRequest(`Command timed out after ${Math.round(timeoutMs / 1000)}s.`))
      }, Math.max(1000, Number(timeoutMs) || DEFAULTS.stopTimeoutMs))
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new BadRequest(error.message))
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0 || code === null) resolve()
        else reject(new BadRequest(`Command exited with code ${code}.`))
      })
    })
  }

  /** Kill a spawned tree; a detached server can outlive its launcher. */
  killTree(pid) {
    if (typeof pid !== 'number' || pid <= 0) return
    if (process.platform === 'win32') {
      const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      child.on('error', () => {})
      return
    }
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }

  /** Tell the model layer that this provider now serves new models. */
  announce() {
    const provider = this.text('provider') || 'local'
    try {
      this.ctx.emit?.('llm/models-updated', provider)
    } catch {
      // an older host without the event is fine
    }
  }

  /** (Re)arm the idle timer; 0 disables unloading. */
  armIdle(override) {
    this.clearIdle()
    const minutes = Number(override ?? this.values.idleMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return
    const period = Math.min(30000, Math.max(2000, Math.round((minutes * 60000) / 4)))
    this.idleSince = Date.now()
    this.idleTimer = setInterval(() => {
      void this.checkIdle(minutes)
    }, period)
    this.idleTimer.unref?.()
  }

  clearIdle() {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = undefined
    this.idleSince = undefined
  }

  /** Unload after the configured idle window, never while a call is running. */
  async checkIdle(minutes) {
    if (this.busy > 1) return
    if (this.idleSince && Date.now() - this.idleSince < minutes * 60000) return
    const probe = await this.probe()
    if (!probe.healthy) {
      this.clearIdle()
      return
    }
    await this.serial(() => this.stopNow()).catch(() => {})
  }

  /** Mark activity so the idle timer restarts from now. */
  touch() {
    if (this.idleTimer) this.idleSince = Date.now()
  }

  /** Start the server when a request targets our provider. */
  shouldAutoStart(options) {
    if (!this.values.autoStart) return false
    const provider = this.text('provider') || 'local'
    return typeof options?.provider === 'string' && options.provider === provider
  }

  /** Start if needed, then report. */
  async ensureRunning() {
    const probe = await this.probe()
    if (probe.healthy) return probe
    await this.serial(() => this.startNow())
    return this.probe()
  }
}

/**
 * Build the `local_model` tool: the model-facing face of the same lifecycle.
 * @param worker - shared worker instance.
 * @returns a tool definition for the host registry.
 */
function buildTool(worker) {
  return {
    name: 'local_model',
    description:
      'Load or unload the local model server that this plugin manages (the DSH provider whose id is configured in its settings). '
      + 'Loading may take tens of seconds and several GB of memory or VRAM; unloading frees them. '
      + 'Call status when a call to that provider failed, start before delegating to it, and stop when the local work is finished.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['status', 'start', 'stop'], description: 'status reports whether the server answers; start loads it (a no-op when it is already up); stop unloads it.' },
        idleMinutes: { type: 'integer', minimum: 0, maximum: 1440, description: 'With start: unload the server after this many idle minutes. 0 keeps the configured value.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'running', 'configured'],
        properties: {
          action: { type: 'string' },
          running: { type: 'boolean' },
          configured: { type: 'boolean' },
          backend: { type: 'string' },
          baseURL: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          contextWindow: { type: 'integer' },
          output: { type: 'string' },
          pill: { type: 'boolean' },
          started: { type: 'boolean' },
          stopped: { type: 'boolean' },
        },
      },
      render(_args, value) {
        const state = value.running ? 'running' : 'stopped'
        const parts = [`local model: ${state}`]
        if (value.running && value.model) parts.push(value.model)
        if (value.running && value.contextWindow) parts.push(`${value.contextWindow} context`)
        if (!value.configured) parts.push('not configured')
        return [{ type: 'text', text: parts.join(' · ') }]
      },
    },
    presentCall() {
      return { card: 'generic', title: 'Local model worker', kind: 'other' }
    },
    timeoutMs: 200000,
    async execute(args) {
      const action = args?.action ?? 'status'
      if (action === 'status') return worker.status()
      if (action === 'start') {
        const idleMinutes = Number.isFinite(args?.idleMinutes) && args.idleMinutes > 0 ? args.idleMinutes : undefined
        return worker.serial(() => worker.startNow({ idleMinutes }))
      }
      if (action === 'stop') return worker.serial(() => worker.stopNow())
      throw new BadRequest(`Unknown action ${JSON.stringify(action)}.`)
    },
  }
}

/** JSON body reader for the RPC route. */
async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text)
}

/** Answer one client request with the envelope the connection layer expects. */
async function serveRpc(worker, request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' })
    response.end()
    return
  }
  let rpcId
  let result
  try {
    const body = await readJsonBody(request)
    rpcId = body?.rpcId
    result = { ok: true, value: await handleRpc(worker, body?.method, body?.payload) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof Error && error.name === 'BadRequest' ? 'bad-request' : 'error'
    result = { ok: false, error: { code, message, details: {} } }
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ type: 'server-response', rpcId, result }))
}

/**
 * One RPC method of the client half.
 * @param worker - shared worker instance.
 * @param method - endpoint name.
 * @param payload - client arguments.
 * @returns a JSON value.
 */
async function handleRpc(worker, method, payload) {
  if (method === 'state') {
    let revision
    try {
      const section = worker.settings?.describe?.().find((form) => form.ns === worker.namespace)
      revision = section?.revision
    } catch {
      revision = undefined
    }
    return {
      namespace: worker.namespace,
      revision,
      defaults: DEFAULTS,
      backends: Object.entries(BACKENDS).map(([id, preset]) => ({ id, label: preset.label, hint: preset.hint, fields: preset.fields })),
      values: worker.values,
      status: await worker.status(),
    }
  }
  if (method === 'status') return worker.status()
  if (method === 'probe') {
    const probe = await worker.probe(payload ?? {})
    return { running: probe.healthy, model: probe.model, models: probe.models, contextWindow: probe.contextWindow, output: probe.detail }
  }
  if (method === 'save') {
    const settings = worker.settings
    if (!settings) throw new BadRequest('Settings are unavailable in this host.')
    const ops = Array.isArray(payload?.ops) ? payload.ops : []
    const revision = Number.isFinite(payload?.revision) ? payload.revision : undefined
    try {
      await settings.mutate(worker.namespace, ops, revision)
    } catch (error) {
      if (!(error?.code === 'SETTINGS_CONFLICT')) throw error
      await settings.mutate(worker.namespace, ops)
    }
    return handleRpc(worker, 'state', undefined)
  }
  if (method === 'start') {
    const idleMinutes = Number.isFinite(payload?.idleMinutes) && payload.idleMinutes > 0 ? payload.idleMinutes : undefined
    return worker.serial(() => worker.startNow({ idleMinutes }))
  }
  if (method === 'stop') return worker.serial(() => worker.stopNow())
  throw new BadRequest(`Unknown endpoint ${JSON.stringify(method)}.`)
}

/**
 * Register the client RPC route on the plugin's own web server injection.
 * @param ctx - plugin context.
 * @param worker - shared worker instance.
 */
function registerRpc(ctx, worker) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: RPC_CHANNEL,
      handler: (request, response) => {
        void serveRpc(worker, request, response)
      },
    }),
    'local-model-worker: rpc channel',
  )
}

export function apply(ctx, config) {
  const worker = new Worker(ctx, config)

  ctx.effect(() => ctx.tools.register(buildTool(worker)), 'local-model-worker: tool')

  ctx.on('llm/stream', (options, next) => {
    const stream = next()
    if (!worker.shouldAutoStart(options)) return stream
    return (async function* preloaded() {
      try {
        await worker.ensureRunning()
      } catch (error) {
        ctx.logger?.warn?.('local-model-worker: auto-start failed: %s', error instanceof Error ? error.message : String(error))
      }
      yield* stream
    })()
  })

  ctx.inject(['settings'], (scoped) => {
    worker.settings = scoped.settings
  })

  registerRpc(ctx, worker)

  ctx.effect(() => () => worker.clearIdle(), 'local-model-worker: cleanup')
}
