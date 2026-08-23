# Placeholder image for the phrasey-server Cloud Run service. Not the game
# server — see packages/server/Dockerfile for that. Built by
# `gcloud builds submit infra/placeholder` (see infra/README.md).
FROM node:22-slim
WORKDIR /app
COPY server.mjs index.html ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
