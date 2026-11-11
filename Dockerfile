ARG NODE_IMAGE=node:24.22.3-alpine3.24@sha256:d8d97e479cdc64f052f81f129362168717c59783ade8dcc1abd22e1cca8dbd7c
FROM ${NODE_IMAGE} AS build

WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json tsconfig.server.json ./
COPY public ./public
COPY src ./src
COPY shared ./shared
COPY server ./server
COPY tests ./tests
RUN npm run build
RUN npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache 'zlib>=1.4-r0'
ENV NODE_ENV=production \
    APP_PORT=8080 \
    DATABASE_PATH=/tmp/yatalk/yatalk.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER node
EXPOSE 8080
CMD ["node", "dist-server/server/index.js"]
