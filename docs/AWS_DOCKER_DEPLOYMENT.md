# AWS and Docker Deployment Submission

## Project Overview

Proxim is a containerized conversational avatar trainer for pharmaceutical sales practice. The browser client provides persona selection, voice/text input, transcript display, 3D avatar animation, lip sync, compliance feedback, and post-call scorecards. The server manages sessions over WebSocket, streams LLM responses, generates TTS audio and visemes, handles transcription fallback, serves avatar assets, and exposes health checks for deployment monitoring.

The deployment model is intentionally split into two services:

- `client`: React/Vite static site served by nginx.
- `server`: Node.js/Express/WebSocket service for runtime orchestration.

This separation keeps the static UI independently cacheable while allowing the server to scale, restart, and manage API credentials separately.

## Technical Specifications

### Runtime and Containers

- Client container: multi-stage Node 20 build, nginx 1.27 Alpine runtime, static asset caching, SPA fallback routing, and baseline security headers.
- Server container: multi-stage Node 20 build, production-only npm install, non-root runtime user, `/health` endpoint, and Docker health check.
- Compose orchestration: client waits for a healthy server, both services restart with `unless-stopped`, and public ports are configurable through environment variables.
- Dependency control: container builds use `npm ci` with existing lockfiles and do not add new runtime dependencies.

### Application Integration

- HTTP API: `VITE_API_URL` points the client to the server REST endpoints, including transcription fallback.
- WebSocket API: `VITE_WS_URL` points the client to the live session transport.
- Avatar proxy/API origin: `VITE_HTTP_SERVER_URL` points browser avatar asset proxy requests to the server.
- Server secrets remain in `server/.env`; API keys are not copied into images or committed.

### Scalability and Security Notes

- EC2 deployment can run Docker Compose directly for review/demo use.
- For larger production use, run the client behind CloudFront/S3 or an ALB-backed container service, and run one or more server tasks behind an Application Load Balancer with WebSocket support.
- Session state is currently in memory, so horizontal server scaling requires sticky sessions or an external session store before multi-instance production scaling.
- Security groups should expose only SSH from trusted IPs, client HTTP/HTTPS, and the server API/WebSocket port if it is not reverse-proxied.
- Store provider credentials in `server/.env` for the demo; use AWS Secrets Manager or SSM Parameter Store for production.

## Deployment Guide

### Local Docker Verification

1. Create the server environment file:

```bash
cp server/.env.example server/.env
```

2. Add at least one provider key to `server/.env`; `GROQ_API_KEY` is the minimum recommended key.

3. Build and start both services:

```bash
docker compose up --build
```

4. Verify the deployment:

```bash
curl http://localhost:3001/health
```

5. Open the client:

```text
http://localhost:8080
```

### AWS EC2 Deployment

1. Launch an Ubuntu EC2 instance and install Docker plus Git.

2. Clone the project and enter the repository:

```bash
git clone <repository-url>
cd Proxim
```

3. Create and fill `server/.env`:

```bash
cp server/.env.example server/.env
nano server/.env
```

4. Set public client build URLs for the EC2 host before building:

```bash
export EC2_HOST=<ec2-public-dns-or-domain>
export VITE_API_URL=http://$EC2_HOST:3001
export VITE_WS_URL=ws://$EC2_HOST:3001
export VITE_HTTP_SERVER_URL=http://$EC2_HOST:3001
```

5. Start the containers:

```bash
docker compose up --build -d
```

6. Confirm service health:

```bash
docker compose ps
curl http://localhost:3001/health
```

7. Open the deployed client:

```text
http://<ec2-public-dns-or-domain>:8080
```

### Reviewer Test Checklist

- Confirm persona selection loads.
- Start a practice call and verify the intro audio plays.
- Send a voice or text prompt and verify transcript streaming, avatar movement, and audio playback.
- End the session and verify the scorecard appears or fails gracefully if provider scoring is unavailable.
- Confirm `docker compose ps` shows healthy services.
- Confirm no API keys are committed and `server/.env` remains local to the host.
