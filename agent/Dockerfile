# The clipper, as an always-on worker (Render "Background Worker").
#
# It is not a web service: it polls /api/agent/clip-jobs/claim, renders
# (Creatomate, with ffmpeg as the fallback) and posts results back. It needs
# Node and ffmpeg and nothing else from the app — so only the few packages it
# imports are installed, not the whole site.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# ES modules, like the app (package.json "type": "module").
RUN npm init -y >/dev/null && npm pkg set type=module \
 && npm install --omit=dev --no-audit --no-fund \
      tsx@^4.20.5 \
      @anthropic-ai/sdk@^0.125.0 \
      sharp@^0.35.4 \
      dotenv@^16.4.7 \
      opentype.js@^2.0.0

COPY agent ./agent
COPY server/textPath.ts ./server/textPath.ts
COPY server/assets ./server/assets
COPY tsconfig.json ./tsconfig.json

ENV NODE_ENV=production
CMD ["npx", "tsx", "agent/clipper.ts"]
