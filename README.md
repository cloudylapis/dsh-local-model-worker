# Local model worker

A DeepSeek Harness plugin that keeps a local OpenAI-compatible model server
**off until it is needed**, then unloads it again once it sits idle.

> 中文：给 DeepSeek Harness 用的插件。本地模型服务平时不占显存，只有真要用到
> 它的时候才启动，闲置一段时间自动卸载。支持 LM Studio / Ollama / llama.cpp /
> 自定义命令。

DSH normally expects a model provider to be reachable all the time. A local,
GPU-sized model is not: loading it costs tens of seconds and several gigabytes
of memory or VRAM, and it sits idle most of the time. This plugin keeps the
provider configured in **Settings → Models** but starts its server only when a
request is about to use it, then stops it after an idle period.

## What you get

- **On demand.** A request to the configured provider id starts the server
  before the call continues. Requests to other providers are untouched.
- **Idle unload.** After `idleMinutes` without requests (default 30, `0` keeps
  it loaded) the server is stopped, so memory and VRAM are released again.
- **Predictable stop path.** Your stop command runs first; otherwise the plugin
  ends the process tree it started. A server started by hand is never killed.
- **No restart after a settings change.** Every operation reads the settings
  fresh, so edits in the card apply to the next request.
- **Model list refreshes in place.** When the server becomes reachable the
  plugin announces the provider's model catalog as changed.
- **A tool for the agent.** `local_model` (`status` / `start` / `stop`) is the
  same lifecycle for an agent: check the server before delegating work to it,
  unload it afterwards.
- **A composer button.** Optional pill that starts and stops the server by hand.

## Built-in backends

| Backend | Default address | Default start | Default stop |
| --- | --- | --- | --- |
| `lmstudio` | `http://127.0.0.1:1234/v1` | `lms server start` | `lms server stop` |
| `ollama` | `http://127.0.0.1:11434/v1` | `ollama serve` | process tree |
| `llamacpp` | `http://127.0.0.1:8080/v1` | `llama-server -m <model file>` | process tree |
| `custom` | whatever you type | your command line | your command line |

Fields you leave empty fall back to the backend preset, so a built-in backend
needs no command line at all. A start or stop command you write yourself always
wins over the preset.

## Install

From the DSH plugin market, search for **Local model worker**. Or from a shell:

```sh
dsh plugin --profile desktop add dsh-local-model-worker
```

GitHub installs work too:

```sh
dsh plugin --profile desktop add github:cloudylapis/dsh-local-model-worker
```

## Set it up

1. Open **Settings → Models**.
2. In the **Local model server** card at the bottom, pick a backend and press
   **Save**.
3. Add the matching provider row above the card. The provider id must equal the
   card's **Provider id** (`local` by default), and the server address must
   equal the card's **Server address**. Choose a model there.
4. Use the model. The first request starts the server; the composer pill and
   the card show when it is up.

Paths with spaces or non-ASCII characters (Chinese directory names, OneDrive
folders) need no special handling: every argument the plugin puts on a command
line is quoted.

## Config

Every field lives in the card and in the plugin Config; all of them are
`volatile`, so an edit applies to the next request without a reload.

| Field | Default | Meaning |
| --- | --- | --- |
| `backend` | `lmstudio` | Which local server to start: `lmstudio`, `ollama`, `llamacpp`, `custom`. |
| `provider` | `local` | Provider route id this server backs, as created in Settings → Models. |
| `baseURL` | preset address | OpenAI-compatible base URL of the server. |
| `apiKey` | empty | Bearer token sent to the server, when it asks for one. |
| `model` | empty | Model id to report as loaded. Empty uses whichever the server lists first. |
| `modelPath` | empty | Model file or model name for llama.cpp (`llama-server -m`). |
| `port` | `0` | Port the preset server listens on. `0` uses the preset default. |
| `contextSize` | `8192` | Context size handed to `llama-server`. `0` keeps the server default. |
| `startCommand` | empty | Command line that starts the server. |
| `stopCommand` | empty | Command line that stops the server. Empty kills the launched process tree. |
| `startCwd` | empty | Working directory for the start command. |
| `logFile` | empty | File that receives the server output. Empty discards it. |
| `startTimeoutMs` | `180000` | How long to wait for the server to answer after starting it. |
| `stopTimeoutMs` | `60000` | How long to wait for the server to stop answering. |
| `probeTimeoutMs` | `2500` | Timeout of one readiness check. |
| `idleMinutes` | `30` | Unload after this many idle minutes. `0` keeps the server loaded. |
| `autoStart` | `true` | Start the server when a request targets its provider. |
| `pill` | `true` | Show the composer button that starts and stops the server. |

## The `local_model` tool

| Call | Effect |
| --- | --- |
| `local_model` with `action: "status"` | Is the server up, which provider is configured, how many idle minutes are left. |
| `local_model` with `action: "start"` | Start it now and wait until it answers. |
| `local_model` with `action: "stop"` | Stop it now, through the same stop path. |

## Limits

- One server per configured endpoint. Two local servers need two plugin entries
  with different provider ids.
- The start command runs inside the DSH process; a command that opens a window
  or needs an interactive prompt will not work.
- The health check reads `<server address>/models`. A server without that route
  can only be started and stopped by hand.
- Delegating to the model needs the route allowed for the conversation
  (`subagent-model-selection-settings`); name the provider `local` and put the
  model in `model`.

## Changes

### 0.4.0

- A start or stop command you write yourself now takes priority over the backend
  preset.
- Only documented DSH theme tokens are used, so the primary button reads
  correctly in the dark theme.
- Backend hints and health-check failures are translated.
- The card no longer reports phantom unsaved changes after switching the backend
  back to the stored value.
- The `local_model` tool declares every field it returns.

## License

MIT
