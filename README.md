# BlockFork AI Session Runtime

Provider-grade backend for BlockFork sessions.

## Run

```bash
cd /Users/pieyushjoy/Projects/blockfork-ai-session-runtime
npm install
export HOST=127.0.0.1
export PORT=3100
export OPENROUTER_API_KEY="your_openrouter_key"
npm start
```

## Canonical API

- `POST /session`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /v1/models`
- `GET /v1/runtime`
- `GET /v1/preflight`

## Compatibility API

- `GET /session/:id`
- `POST /session/:id/v1/chat/completions`
- `POST /session/:id/v1/responses`
- `GET /session/:id/v1/models`
- `GET /session/:id/v1/runtime`
- `GET /session/:id/v1/preflight`
