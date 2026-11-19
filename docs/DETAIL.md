# Local model on demand

DSH normally expects a model provider to be reachable all the time. A local,
GPU-sized model is not: loading it costs tens of seconds and several gigabytes
of memory or VRAM, and it sits idle most of the time. This plugin keeps the
provider configured in **Settings → Models** but starts its server only when a
request is about to use it, then unloads it again after an idle period.

## Set it up

1. Open **Settings → Models** and keep DSH open on that page.
2. In the **Local model server** card at the bottom, pick a built-in backend:
   - **LM Studio** — the server on `http://127.0.0.1:1234/v1`, started with the
     `lms` CLI (`lms server start`, stopped with `lms server stop`).
   - **Ollama** — `http://127.0.0.1:11434/v1`, started with `ollama serve`.
   - **llama.cpp** — `http://127.0.0.1:8080/v1`, started with
     `llama-server -m <model file>`; choose the model file and, optionally, the
     port and context size.
   - **Custom** — your own start and stop command lines.
3. Press **Save**. The fields you leave empty fall back to the backend preset,
   so a built-in backend needs no command line at all. A start or stop command
   you write yourself always wins over the preset, which keeps a launcher script
   working even when the backend selector still sits on its default. Leave the
   selector on **Custom** when you write your own commands — that is the label
   the card and the status chips show, so the card keeps telling the truth.
4. Add the matching provider row above the card (the provider id must equal the
   card's **Provider id**, `local` by default; the server address must equal the
   card's **Server address**). Choose a model there.
5. Use the model. The first request starts the server; the composer button and
   the card show when it is up.

Paths with spaces or non-ASCII characters (Chinese directory names, OneDrive
folders) do not need anything special: the plugin quotes every argument it puts
on a command line, and passes user-written command lines to the platform shell
unchanged.

## How it behaves

- **On demand.** A request to the configured provider id starts the server
  before the call continues. Requests to other providers are untouched.
- **Idle unload.** After `idleMinutes` without requests (default 30, `0` keeps
  the server loaded) the server is stopped, so memory and VRAM are released.
  The timer lives in the DSH process: while DSH runs, an idle server is stopped.
- **Stop path.** A configured stop command runs first; otherwise the plugin ends
  the process tree it started (`taskkill /PID <pid> /T /F` on Windows, a process
  group signal on POSIX). A server started by hand is never killed — the card
  then asks for a stop command instead.
- **No restart after a settings change.** The card writes through the Host
  settings API, and every operation reads the settings fresh. When the server
  becomes reachable the plugin announces the provider's model catalog as
  changed, so the model list refreshes in place.
- **The tool.** `local_model` (`status` / `start` / `stop`) is the same
  lifecycle for an agent: it can check the server before delegating work to it
  and unload it afterwards.

## Limits

- One server per configured endpoint. Two different local servers need two
  plugin entries with different provider ids.
- The start command runs in the DSH process; a command that opens a window or
  needs an interactive prompt will not work.
- The health check reads `<server address>/models`. A server that does not
  expose that route can only be started and stopped manually.
- Delegating to the model needs the route to be allowed for the conversation
  (`subagent-model-selection-settings` in the profile patch). DSH records that
  allowlist into a conversation when the conversation is created, so an older
  conversation never sees a model that was added later — open a new one. Name
  the provider by its id, `local`, and put the model in `model` (`local-9b`);
  passing the model id as the provider is what produces
  `LLM provider "local-9b" is not allowed for this Session`.

## Changes

### 0.4.0 (2026-11-18)

- A start or stop command you write yourself now takes priority over the
  backend preset. Before this, a profile that set `startCommand` but left the
  backend on its default tried to run the preset's command line instead (for
  example `lms server start`), so on-demand start silently failed.
- Only the visual theme tokens DSH documents are used. The primary button used
  an undocumented pair and rendered white-on-white in the dark theme; it now
  reads `label-primary` on `bg-base`.
- Backend hints and health-check failures are translated: the card no longer
  shows English text inside a Chinese UI.
- The card no longer claims unsaved changes after you switch the backend back to
  the value that is actually stored, and switching backends clears the command
  lines that belong to the previous one.
- The `local_model` tool declares every field it returns, so its result is no
  longer rejected by output validation.
- Verified end to end: on-demand start through a real request, the stop path,
  the idle unload (`idleMinutes`), the save round trip into the profile patch
  file, and the card in both light and dark themes.
