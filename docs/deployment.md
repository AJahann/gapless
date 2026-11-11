# Deployment and Hardening Guide

## Overview

The gapless architecture runs two backend containers (`server` Fastify+WS and `web` Next.js) behind an ingress reverse proxy (`caddy`).

## Public vs Local Configuration

### Public Production (`docker-compose.yml`)

1. **Port Isolation**: Neither `server` (4000) nor `web` (3000) publish host ports. Only Caddy port 80 (and 443) is published to ingress traffic. Direct external access to raw backend services is blocked.
2. **Disabled Mutating Controls**: `TEST_CONTROL=false`. Mutating endpoints (`/api/feeds/:id/pause`, `/api/feeds/:id/unpause`, `/api/feeds/:id/restart`, `/api/feeds/:id/digest`) are not registered. WebSocket client `pause`/`unpause` messages are ignored.
3. **Non-Root Containers**: Both `Dockerfile.server` and `Dockerfile.web` run as the unprivileged `node` user (UID 1000).
4. **Replay Window**: Default configured replay window is 30 seconds (`REPLAY_WINDOW_SEC=30`).

### Local Development / Debugging (`docker-compose.local.yml`)

To run locally with direct service ports and test control routes enabled:

```sh
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

- Binds `server` directly to loopback only (`127.0.0.1:4000:4000`).
- Binds `web` directly to loopback only (`127.0.0.1:3000:3000`).
- Enables `TEST_CONTROL=true` for test/chaos driving.

## TLS Termination

Plaintext HTTP (`:80`) is for internal network communication only. It is **not** a valid public TLS deployment configuration.

For public production:

1. **Automated Caddy TLS**: Update `Caddyfile` with your public domain name:

   ```caddyfile
   demo.example.com {
       handle /api/* {
           reverse_proxy server:4000
       }
       handle /ws/* {
           reverse_proxy server:4000
       }
       handle {
           reverse_proxy web:3000
       }
   }
   ```

   Caddy will automatically provision and renew Let's Encrypt / ZeroSSL certificates.
2. **Cloudflare / ALB Ingress**: If running behind a reverse proxy (e.g. Cloudflare Tunnel, AWS ALB, Nginx):
   - Terminate TLS at the edge.
   - Restrict origin traffic to ingress IP ranges.
   - Pass standard proxy headers (`X-Forwarded-For`, `X-Forwarded-Proto`, `Host`).
