/**
 * Client half of the local model worker: a card at the bottom of
 * Settings → Models that configures the local server, and a composer button
 * that shows and toggles its state.
 *
 * The card talks to this package's host half over the plugin RPC channel; the
 * host owns the process lifecycle, so nothing here spawns anything.
 */
window.__ModuleLoader__.load({
  id: '@local/local-model-worker',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const NS = '@local/local-model-worker'
    const CHANNEL = '/local-model-worker'
    const POLL_MS = 5000
    const STYLE_ID = 'local-model-worker-style'

    /** Copy, flat: the locale lookup does not walk dotted keys into objects. */
    const DICT = {
      zh: {
        'title': '本地模型服务',
        'description': '只在用到时才启动，空闲一段时间后自动卸载。',
        'status.online': '服务在线',
        'status.offline': '服务未启动',
        'status.unknown': '正在检查',
        'detail.notListening': '这个地址上没有服务在监听',
        'action.start': '启动',
        'action.stop': '停止',
        'action.starting': '启动中…',
        'action.stopping': '停止中…',
        'action.test': '测试连接',
        'action.testing': '测试中…',
        'action.save': '保存',
        'action.saving': '保存中…',
        'action.discard': '放弃修改',
        'action.advanced': '更多设置',
        'saved': '已保存。',
        'savedHint': '改动会立即生效，无需重启。',
        'clean': '没有未保存的修改。',
        'readonly': '当前配置为只读，无法保存。',
        'unsaved': '有未保存的修改。',
        'conflict': '配置已被其他窗口修改，请重试。',
        'invalidNumber': '请填入不含负号的数字。',
        'missingStart': '请先填写启动命令，或选择一个内置后端。',
        'missingModelPath': '请先选择 llama.cpp 的模型文件。',
        'preset': '内置后端',
        'route': '路由',
        'advancedTitle': '空闲与超时',
        'label.backend': '本地后端',
        'label.provider': '提供商 ID',
        'label.baseURL': '服务地址',
        'label.apiKey': 'API Key',
        'label.model': '模型 ID',
        'label.modelPath': '模型文件',
        'label.port': '端口',
        'label.contextSize': '上下文长度',
        'label.startCommand': '启动命令',
        'label.stopCommand': '停止命令',
        'label.startCwd': '工作目录',
        'label.logFile': '日志文件',
        'label.startTimeoutMs': '启动超时（毫秒）',
        'label.stopTimeoutMs': '停止超时（毫秒）',
        'label.probeTimeoutMs': '探测超时（毫秒）',
        'label.idleMinutes': '空闲卸载（分钟）',
        'label.autoStart': '按需自动启动',
        'label.pill': '在输入框旁显示按钮',
        'hint.backend': '内置后端会自动填好启动方式，无需手写命令。',
        'hint.backend.lmstudio': '需要 PATH 上有 LM Studio 的命令行工具 lms。',
        'hint.backend.ollama': '需要 PATH 上有 ollama 可执行文件。',
        'hint.backend.llamacpp': '需要 PATH 上有 llama-server，并指定一个模型文件。',
        'hint.backend.custom': '任意能启动 OpenAI 兼容服务的命令行。',
        'hint.provider': '与 设置 → 模型 里添加的提供商 ID 一致，只有发给它的请求才会拉起服务。',
        'hint.baseURL': '留空使用内置地址；需要与模型页里填写的地址保持一致。',
        'hint.apiKey': '可选。健康检查时会以 Bearer 方式发送。',
        'hint.model': '可选。用于报告上下文窗口，留空则采用服务器返回的第一个模型。',
        'hint.modelPath': 'GGUF 文件或模型名，路径含空格或中文时会自动加引号。',
        'hint.port': '内置后端的监听端口，0 表示使用默认端口。',
        'hint.contextSize': '传给 llama-server 的 --ctx-size，0 表示使用服务器默认值。',
        'hint.startCommand': '任意可执行命令行：llama-server、ollama serve、脚本或服务命令。',
        'hint.stopCommand': '留空时结束本插件启动的进程树。',
        'hint.startCwd': '可选。启动命令的工作目录。',
        'hint.logFile': '可选。服务器输出会写入此文件。',
        'hint.startTimeoutMs': '启动后等待服务响应的最长时间。',
        'hint.stopTimeoutMs': '停止后等待服务不再响应的最长时间。',
        'hint.probeTimeoutMs': '单次健康检查的超时时间。',
        'hint.idleMinutes': '这段时间没有请求就卸载。0 表示保持加载。',
        'hint.autoStart': '发给该提供商的请求会自动拉起服务。',
        'hint.pill': '关闭后只在设置页里操作。',
        'pill.idle': '本地模型',
        'pill.running': '本地模型',
        'pill.busy': '本地模型',
        'pill.unset': '本地模型 · 未配置',
        'pill.title': '点击启动或停止本地模型服务',
      },
      en: {
        'title': 'Local model server',
        'description': 'Started only when it is used, unloaded again after it sits idle.',
        'status.online': 'Server is up',
        'status.offline': 'Server is not running',
        'status.unknown': 'Checking',
        'detail.notListening': 'nothing is listening on that address',
        'action.start': 'Start',
        'action.stop': 'Stop',
        'action.starting': 'Starting…',
        'action.stopping': 'Stopping…',
        'action.test': 'Test connection',
        'action.testing': 'Testing…',
        'action.save': 'Save',
        'action.saving': 'Saving…',
        'action.discard': 'Discard',
        'action.advanced': 'More settings',
        'saved': 'Saved.',
        'savedHint': 'Changes apply immediately; no restart needed.',
        'clean': 'Nothing to save.',
        'readonly': 'This configuration is read only.',
        'unsaved': 'Unsaved changes.',
        'conflict': 'The configuration changed elsewhere; try again.',
        'invalidNumber': 'Enter a number without a minus sign.',
        'missingStart': 'Set a start command, or pick a built-in backend.',
        'missingModelPath': 'Pick the llama.cpp model file first.',
        'preset': 'Built-in backend',
        'route': 'Route',
        'advancedTitle': 'Idle and timeouts',
        'label.backend': 'Local backend',
        'label.provider': 'Provider id',
        'label.baseURL': 'Server address',
        'label.apiKey': 'API key',
        'label.model': 'Model id',
        'label.modelPath': 'Model file',
        'label.port': 'Port',
        'label.contextSize': 'Context size',
        'label.startCommand': 'Start command',
        'label.stopCommand': 'Stop command',
        'label.startCwd': 'Working directory',
        'label.logFile': 'Log file',
        'label.startTimeoutMs': 'Start timeout (ms)',
        'label.stopTimeoutMs': 'Stop timeout (ms)',
        'label.probeTimeoutMs': 'Probe timeout (ms)',
        'label.idleMinutes': 'Unload when idle (min)',
        'label.autoStart': 'Start on demand',
        'label.pill': 'Show the composer button',
        'hint.backend': 'A built-in backend fills in how to start it, so no command line is needed.',
        'hint.backend.lmstudio': 'Requires the LM Studio CLI (lms) on PATH.',
        'hint.backend.ollama': 'Requires the ollama executable on PATH.',
        'hint.backend.llamacpp': 'Requires llama-server on PATH and a model file.',
        'hint.backend.custom': 'Any command line that starts an OpenAI-compatible server.',
        'hint.provider': 'Match the provider id you created in Settings → Models; only requests to it start the server.',
        'hint.baseURL': 'Empty uses the built-in address. Keep it identical to the provider row in Models.',
        'hint.apiKey': 'Optional. Sent as a Bearer token during the health check.',
        'hint.model': 'Optional. Reported as the loaded model; empty uses the first model the server lists.',
        'hint.modelPath': 'GGUF file or model name. Paths with spaces or non-ASCII characters are quoted for you.',
        'hint.port': 'Port the built-in backend listens on. 0 uses its default.',
        'hint.contextSize': 'Passed to llama-server as --ctx-size. 0 keeps the server default.',
        'hint.startCommand': 'Any command line: llama-server, ollama serve, a script, or a service command.',
        'hint.stopCommand': 'Empty kills the process tree this plugin started.',
        'hint.startCwd': 'Optional working directory for the start command.',
        'hint.logFile': 'Optional. Server output is appended to this file.',
        'hint.startTimeoutMs': 'How long to wait for the server to answer after a start.',
        'hint.stopTimeoutMs': 'How long to wait for the server to stop answering.',
        'hint.probeTimeoutMs': 'Timeout of one health check.',
        'hint.idleMinutes': 'Unload after this long without requests. 0 keeps it loaded.',
        'hint.autoStart': 'A request to that provider starts the server by itself.',
        'hint.pill': 'When off, control it from this settings card only.',
        'pill.idle': 'Local model',
        'pill.running': 'Local model',
        'pill.busy': 'Local model',
        'pill.unset': 'Local model · not set up',
        'pill.title': 'Click to start or stop the local model server',
      },
    }

    /** Settings fields and how the card renders each one. */
    const FIELDS = {
      provider: { kind: 'text', placeholder: 'local', mono: true },
      baseURL: { kind: 'text', placeholderFrom: 'baseURL', mono: true },
      apiKey: { kind: 'text', mono: true },
      model: { kind: 'text' },
      modelPath: { kind: 'text', mono: true },
      port: { kind: 'number' },
      contextSize: { kind: 'number' },
      startCommand: { kind: 'text', mono: true },
      stopCommand: { kind: 'text', mono: true },
      startCwd: { kind: 'text', mono: true },
      logFile: { kind: 'text', mono: true },
      startTimeoutMs: { kind: 'number' },
      stopTimeoutMs: { kind: 'number' },
      probeTimeoutMs: { kind: 'number' },
      idleMinutes: { kind: 'number' },
      autoStart: { kind: 'boolean' },
      pill: { kind: 'boolean' },
    }

    /** Advanced fields stay collapsed until the user asks for them. */
    const ADVANCED = ['startTimeoutMs', 'stopTimeoutMs', 'probeTimeoutMs', 'idleMinutes', 'autoStart', 'pill', 'logFile', 'provider']

    /** Stylesheet contents, built from theme tokens so light and dark both work. */
    const CSS = `
.lmw-card{display:flex;flex-direction:column;gap:14px;padding:16px 18px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));color:var(--dsw-alias-label-primary,inherit);font-size:inherit}
.lmw-head{display:flex;align-items:flex-start;gap:10px}
.lmw-headText{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.lmw-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;line-height:20px}
.lmw-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary,currentColor)}
.lmw-dot[data-state=on]{background:var(--dsw-alias-state-success-primary,#2fbf71)}
.lmw-dot[data-state=off]{background:var(--dsw-alias-state-idle-primary,rgba(127,127,127,.6))}
.lmw-dot[data-state=busy]{background:var(--dsw-alias-state-warn-primary,#d9a53a)}
.lmw-dot[data-state=error]{background:var(--dsw-alias-state-error-primary,#e05252)}
.lmw-desc{color:var(--dsw-alias-label-secondary,inherit);font-size:12px;line-height:18px}
.lmw-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.lmw-chip{font-size:11px;line-height:16px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));color:var(--dsw-alias-label-secondary,inherit)}
.lmw-seg{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.lmw-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;line-height:22px;padding:0 10px;border-radius:6px;cursor:pointer;transition:background 120ms ease,color 120ms ease}
.lmw-seg button[data-active=true]{background:var(--dsw-alias-label-primary,rgba(127,127,127,.22));color:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff))}
.lmw-seg button:disabled{opacity:.5;cursor:default}
.lmw-grid{display:flex;flex-direction:column;gap:12px}
.lmw-field{display:flex;flex-direction:column;gap:6px}
.lmw-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary,inherit)}
.lmw-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,inherit)}
.lmw-input,.lmw-textarea{box-sizing:border-box;width:100%;min-height:30px;padding:5px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;line-height:18px}
.lmw-input[data-mono=true],.lmw-textarea[data-mono=true]{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.lmw-input::placeholder,.lmw-textarea::placeholder{color:var(--dsw-alias-label-secondary,inherit);opacity:.7}
.lmw-input:focus-visible,.lmw-textarea:focus-visible,.lmw-seg button:focus-visible,.lmw-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4a6cf7);outline-offset:1px}
.lmw-textarea{resize:vertical;min-height:56px}
.lmw-switchRow{display:flex;align-items:flex-start;gap:10px}
.lmw-switchRow input{margin:3px 0 0;flex:none}
.lmw-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
.lmw-spacer{flex:1}
.lmw-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}
.lmw-note[data-tone=ok]{color:var(--dsw-alias-state-success-primary,#2fbf71)}
.lmw-note[data-tone=error]{color:var(--dsw-alias-state-error-primary,#e05252)}
.lmw-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 12px;border-radius:8px;border:1px solid transparent;font:inherit;font-size:12px;font-weight:500;cursor:pointer;transition:background 120ms ease,opacity 120ms ease,border-color 120ms ease}
.lmw-btn[data-kind=primary]{background:var(--dsw-alias-label-primary,#0f1115);color:var(--dsw-alias-bg-base,#fff)}
.lmw-btn[data-kind=primary]:hover:not(:disabled){opacity:.86}
.lmw-btn[data-kind=ghost]{background:transparent;border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.3));color:var(--dsw-alias-label-primary,inherit)}
.lmw-btn[data-kind=ghost]:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
.lmw-btn:disabled{opacity:.5;cursor:default}
.lmw-link{appearance:none;border:0;background:transparent;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-brand-primary,var(--dsw-alias-label-primary,inherit));cursor:pointer}
.lmw-pill{appearance:none;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:11px;line-height:1;cursor:pointer;transition:background 120ms ease}
.lmw-pill:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
.lmw-pill:disabled{opacity:.6;cursor:default}
.lmw-srOnly{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`

    /** Inject the package stylesheet once and drop it with the client run. */
    function installStyles(ctx) {
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {}
        const existing = document.getElementById(STYLE_ID)
        if (existing) existing.remove()
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, 'local-model-worker: styles')
    }

    /** Draft value for one field, with numbers kept as strings while editing. */
    function draftFrom(values) {
      const draft = {}
      for (const key of Object.keys(FIELDS)) {
        const value = values?.[key]
        draft[key] = FIELDS[key].kind === 'number' ? String(value ?? '') : typeof value === 'boolean' ? value : value ?? ''
      }
      return draft
    }

    /** Compare the draft with the saved values and build settings operations. */
    function buildOps(draft, values) {
      const ops = []
      for (const key of Object.keys(FIELDS)) {
        const kind = FIELDS[key].kind
        if (kind === 'boolean') {
          const next = draft[key] === true
          if (next !== (values?.[key] === true)) ops.push({ op: 'set', path: [key], value: next })
          continue
        }
        if (kind === 'number') {
          const text = String(draft[key] ?? '').trim()
          if (text === '') {
            if ((values?.[key] ?? 0) !== 0) ops.push({ op: 'unset', path: [key] })
            continue
          }
          if (!/^\d+$/.test(text)) return { error: 'invalidNumber' }
          const next = Number(text)
          if (next !== (values?.[key] ?? 0)) ops.push({ op: 'set', path: [key], value: next })
          continue
        }
        const next = String(draft[key] ?? '').trim()
        if (next === '') {
          if ((values?.[key] ?? '') !== '') ops.push({ op: 'unset', path: [key] })
        } else if (next !== String(values?.[key] ?? '')) {
          ops.push({ op: 'set', path: [key], value: next })
        }
      }
      return { ops }
    }

    /** One labelled control, with the optional description under it. */
    function Field({ id, label, hint, children }) {
      return h(
        'div',
        { className: 'lmw-field' },
        h('label', { className: 'lmw-label', htmlFor: id }, label),
        children,
        hint ? h('div', { className: 'lmw-hint' }, hint) : null,
      )
    }

    /** Text/number input bound to the draft. */
    function TextField({ id, value, placeholder, mono, numeric, disabled, onChange }) {
      return h('input', {
        id,
        className: 'lmw-input',
        type: 'text',
        inputMode: numeric ? 'numeric' : undefined,
        'data-mono': mono ? 'true' : 'false',
        value,
        placeholder,
        disabled,
        spellCheck: false,
        autoComplete: 'off',
        onChange: (event) => onChange(event.target.value),
      })
    }

    /** Checkbox row. */
    function Toggle({ id, label, hint, checked, disabled, onChange }) {
      return h(
        'div',
        { className: 'lmw-switchRow' },
        h('input', { id, type: 'checkbox', checked, disabled, onChange: (event) => onChange(event.target.checked) }),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('label', { className: 'lmw-label', htmlFor: id, style: { cursor: 'pointer' } }, label),
          hint ? h('div', { className: 'lmw-hint' }, hint) : null,
        ),
      )
    }

    /** Build the settings card component for the given client context. */
    function makeCard(ctx) {
      const t = ctx.locale.bind(NS)
      const call = (method, payload) => {
        const connection = ctx.get('connection')
        if (!connection) return Promise.reject(new Error('connection unavailable'))
        return connection.rpc.call(CHANNEL, method, payload ?? {}).then((reply) => {
          if (reply && reply.ok) return reply.value
          const error = new Error(reply?.error?.message ?? 'request failed')
          error.code = reply?.error?.code
          throw error
        })
      }

      return function LocalModelCard() {
        const [state, setState] = useState(null)
        const [draft, setDraft] = useState(null)
        const [status, setStatus] = useState(null)
        const [note, setNote] = useState(null)
        const [busy, setBusy] = useState('')
        const [testing, setTesting] = useState(false)
        const [advanced, setAdvanced] = useState(false)

        const adopt = useCallback((value) => {
          setState(value)
          setStatus(value?.status ?? null)
          setDraft(draftFrom(value?.values))
        }, [])

        useEffect(() => {
          let alive = true
          call('state')
            .then((value) => {
              if (alive) adopt(value)
            })
            .catch((error) => {
              if (alive) setNote({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
            })
          return () => {
            alive = false
          }
        }, [adopt])

        useEffect(() => {
          let alive = true
          let timer = null
          const tick = () => {
            call('status')
              .then((value) => {
                if (alive) setStatus(value)
              })
              .catch(() => {})
              .then(() => {
                if (alive) timer = setTimeout(tick, POLL_MS)
              })
          }
          timer = setTimeout(tick, POLL_MS)
          return () => {
            alive = false
            if (timer) clearTimeout(timer)
          }
        }, [])

        const values = state?.values ?? {}
        const backends = useMemo(() => state?.backends ?? [], [state])
        const backend = draft?.backend ?? values.backend ?? 'lmstudio'
        const preset = backends.find((entry) => entry.id === backend)
        const backendHint = useMemo(() => {
          if (!preset) return ''
          const key = `hint.backend.${preset.id}`
          const text = t(key)
          return text && text !== key ? text : preset.hint ?? ''
        }, [preset, t])
        const visible = useMemo(() => preset?.fields ?? [], [preset])

        const update = (key, value) => {
          setNote(null)
          setDraft((current) => {
            const next = { ...(current ?? {}), [key]: value }
            if (key === 'backend') {
              // The preset owns start/stop for built-in backends; drop stale custom
              // commands so a saved switch cannot leave the old launcher behind.
              const owned = backends.find((entry) => entry.id === value)?.fields ?? []
              if (!owned.includes('startCommand')) next.startCommand = ''
              if (!owned.includes('stopCommand')) next.stopCommand = ''
            }
            return next
          })
        }

        const built = useMemo(() => (draft ? buildOps(draft, values) : { ops: [] }), [draft, values])
        const dirty = Boolean(built.error) || Boolean(built.ops && built.ops.length > 0)
        const running = status?.running === true
        const configured = status?.configured === true
        const actionBusy = busy !== ''

        const run = async (method, label, payload) => {
          setBusy(label)
          setNote(null)
          try {
            const value = await call(method, payload)
            if (value && typeof value === 'object') {
              setStatus((current) => ({ ...(current ?? {}), ...value }))
            }
            return value
          } catch (error) {
            setNote({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
            return undefined
          } finally {
            setBusy('')
          }
        }

        const onSave = async () => {
          if (!draft) return
          if (built.error) {
            setNote({ tone: 'error', text: t(built.error) })
            return
          }
          if (built.ops.length === 0) {
            setNote({ tone: 'ok', text: t('clean') })
            return
          }
          setBusy('save')
          setNote(null)
          try {
            const value = await call('save', { ops: built.ops, revision: state?.revision })
            adopt(value)
            setNote({ tone: 'ok', text: `${t('saved')} ${t('savedHint')}` })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            setNote({ tone: 'error', text: /conflict/i.test(message) ? t('conflict') : message })
          } finally {
            setBusy('')
          }
        }

        const onTest = async () => {
          if (!draft) return
          setTesting(true)
          setNote(null)
          try {
            const value = await call('probe', { baseURL: String(draft.baseURL ?? ''), apiKey: String(draft.apiKey ?? ''), backend: draft.backend })
            const detail = String(value?.output ?? '').trim()
            const readable = detail === 'not listening' ? t('detail.notListening') : detail
            setNote({
              tone: value?.running ? 'ok' : 'error',
              text: value?.running
                ? `${t('status.online')} · ${value.model || readable}`
                : readable ? `${t('status.offline')} · ${readable}` : t('status.offline'),
            })
          } catch (error) {
            setNote({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
          } finally {
            setTesting(false)
          }
        }

        const onToggleServer = async () => {
          if (!configured && !running) {
            setNote({ tone: 'error', text: t(backend === 'llamacpp' ? 'missingModelPath' : 'missingStart') })
            return
          }
          await run(running ? 'stop' : 'start', running ? 'stop' : 'start')
        }

        if (!state || !draft) {
          return h(
            'section',
            { className: 'lmw-card' },
            h('div', { className: 'lmw-head' }, h('div', { className: 'lmw-headText' }, h('div', { className: 'lmw-title' }, h('span', { className: 'lmw-dot', 'data-state': 'off' }), t('title'))),
              h('div', { className: 'lmw-desc' }, t('status.unknown'))),
          )
        }

        const statusLabel = status === null ? t('status.unknown') : running ? t('status.online') : t('status.offline')
        const dot = actionBusy ? 'busy' : running ? 'on' : configured ? 'off' : 'error'

        const renderControl = (key) => {
          const field = FIELDS[key]
          const id = `lmw-${key}`
          const label = t(`label.${key}`)
          const hint = t(`hint.${key}`)
          if (field.kind === 'boolean') {
            return h(Toggle, {
              key,
              id,
              label,
              hint,
              checked: draft[key] === true,
              disabled: actionBusy,
              onChange: (next) => update(key, next),
            })
          }
          const placeholder = field.placeholderFrom ? String(state.defaults?.[field.placeholderFrom] ?? '') : field.placeholder ?? ''
          return h(
            Field,
            { key, id, label, hint },
            h(TextField, {
              id,
              value: String(draft[key] ?? ''),
              placeholder,
              mono: field.mono,
              numeric: field.kind === 'number',
              disabled: actionBusy,
              onChange: (next) => update(key, next),
            }),
          )
        }

        return h(
          'section',
          { className: 'lmw-card', 'aria-label': t('title') },
          h(
            'div',
            { className: 'lmw-head' },
            h(
              'div',
              { className: 'lmw-headText' },
              h('div', { className: 'lmw-title' }, h('span', { className: 'lmw-dot', 'data-state': dot }), t('title')),
              h('div', { className: 'lmw-desc' }, t('description')),
              h(
                'div',
                { className: 'lmw-meta' },
                h('span', { className: 'lmw-chip' }, preset?.label ?? backend),
                h('span', { className: 'lmw-chip' }, statusLabel),
                status?.model ? h('span', { className: 'lmw-chip' }, status.model) : null,
                status?.contextWindow ? h('span', { className: 'lmw-chip' }, `${status.contextWindow} ctx`) : null,
                status?.baseURL ? h('span', { className: 'lmw-chip' }, status.baseURL) : null,
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'lmw-btn',
                'data-kind': running ? 'ghost' : 'primary',
                disabled: actionBusy,
                onClick: onToggleServer,
              },
              actionBusy ? t(busy === 'start' ? 'action.starting' : 'action.stopping') : running ? t('action.stop') : t('action.start'),
            ),
          ),
          h(
            Field,
            { id: 'lmw-backend', label: t('label.backend'), hint: t('hint.backend') },
            h(
              'div',
              { className: 'lmw-seg', role: 'group', 'aria-label': t('label.backend') },
              backends.map((entry) =>
                h(
                  'button',
                  {
                    key: entry.id,
                    type: 'button',
                    'data-active': entry.id === backend ? 'true' : 'false',
                    disabled: actionBusy,
                    onClick: () => update('backend', entry.id),
                  },
                  entry.label,
                ),
              ),
            ),
          ),
          backendHint ? h('div', { className: 'lmw-hint' }, backendHint) : null,
          h('div', { className: 'lmw-grid' }, visible.map(renderControl)),
          h(
            'div',
            { className: 'lmw-field' },
            h(
              'button',
              {
                type: 'button',
                className: 'lmw-link',
                onClick: () => setAdvanced((current) => !current),
                'aria-expanded': advanced ? 'true' : 'false',
              },
              `${advanced ? '▾' : '▸'} ${t('advancedTitle')}`,
            ),
          ),
          advanced ? h('div', { className: 'lmw-grid' }, ADVANCED.map(renderControl)) : null,
          h(
            'div',
            { className: 'lmw-foot' },
            h(
              'button',
              { type: 'button', className: 'lmw-btn', 'data-kind': 'ghost', disabled: actionBusy || testing, onClick: onTest },
              testing ? t('action.testing') : t('action.test'),
            ),
            h('span', { className: 'lmw-spacer' }),
            dirty
              ? h(
                'button',
                {
                  type: 'button',
                  className: 'lmw-btn',
                  'data-kind': 'ghost',
                  disabled: actionBusy,
                  onClick: () => {
                    setDraft(draftFrom(values))
                    setNote(null)
                  },
                },
                t('action.discard'),
              )
              : null,
            h(
              'button',
              { type: 'button', className: 'lmw-btn', 'data-kind': 'primary', disabled: actionBusy || !dirty, onClick: onSave },
              busy === 'save' ? t('action.saving') : t('action.save'),
            ),
          ),
          note ? h('div', { className: 'lmw-note', 'data-tone': note.tone, role: 'status' }, note.text) : dirty ? h('div', { className: 'lmw-note' }, t('unsaved')) : null,
        )
      }
    }

    /** Composer button showing the live state of the server. */
    function makePill(ctx) {
      const t = ctx.locale.bind(NS)
      const call = (method, payload) => {
        const connection = ctx.get('connection')
        if (!connection) return Promise.reject(new Error('connection unavailable'))
        return connection.rpc.call(CHANNEL, method, payload ?? {}).then((reply) => {
          if (reply && reply.ok) return reply.value
          throw new Error(reply?.error?.message ?? 'request failed')
        })
      }
      return function LocalModelPill() {
        const [status, setStatus] = useState(null)
        const [busy, setBusy] = useState(false)

        useEffect(() => {
          let alive = true
          let timer = null
          const tick = () => {
            call('status')
              .then((value) => {
                if (alive) setStatus(value)
              })
              .catch(() => {})
              .then(() => {
                if (alive) timer = setTimeout(tick, POLL_MS)
              })
          }
          tick()
          return () => {
            alive = false
            if (timer) clearTimeout(timer)
          }
        }, [])

        if (status && status.pill === false) return null
        const running = status?.running === true
        const configured = status?.configured !== false
        const dot = busy ? 'busy' : running ? 'on' : configured ? 'off' : 'error'
        const label = busy ? t('pill.busy') : running ? `${t('pill.running')} · ${status?.contextWindow ? `${Math.round(status.contextWindow / 1024)}K` : status?.model ?? ''}` : configured ? t('pill.idle') : t('pill.unset')

        const onToggle = async () => {
          if (busy) return
          setBusy(true)
          try {
            await call(running ? 'stop' : 'start', {})
            const next = await call('status')
            setStatus(next)
          } catch {
            // the next poll reports the failure
          } finally {
            setBusy(false)
          }
        }

        return h(
          'button',
          {
            type: 'button',
            className: 'lmw-pill',
            title: t('pill.title'),
            disabled: busy || (!configured && !running),
            onClick: onToggle,
          },
          h('span', { className: 'lmw-dot', 'data-state': dot }),
          h('span', null, label),
        )
      }
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        installStyles(ctx)
        ctx.effect(() => ctx.locale.register(NS, DICT), 'local-model-worker: copy')

        const Card = makeCard(ctx)
        const Pill = makePill(ctx)

        ctx.slots.inject('settings.models.footer', () =>
          ctx.slots.register({ name: 'settings.models.footer', id: 'local-model-worker', order: 10, locale: NS }, Card),
        )
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'local-model-worker', order: 30, locale: NS }, Pill),
        )
      },
    }
  },
})
