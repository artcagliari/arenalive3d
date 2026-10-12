FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    REMOTE_ACCESS=true \
    AUDIO_SAFE_MODE=true

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/scripts/container-start.sh ./scripts/container-start.sh
COPY --from=build /app/deployment/seed-data ./seed-data

RUN chmod +x /app/scripts/container-start.sh
EXPOSE 8787
ENTRYPOINT ["/app/scripts/container-start.sh"]
