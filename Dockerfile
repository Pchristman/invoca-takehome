# Stage 1: build the web app with Vite.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npx vite build

# Stage 2: production dependencies only; run the same server as `npm start`.
FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data DB_PATH=/app/db/calls.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src/ai ./src/ai
COPY src/core ./src/core
COPY src/db ./src/db
COPY src/node ./src/node
COPY src/server ./src/server
COPY --from=build /app/dist ./dist
RUN mkdir -p .cache logs && chown node:node .cache logs
# The database folder is a named volume in compose; the app seeds it on first run.
RUN mkdir -p db && chown node:node db
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server/cli.ts"]
