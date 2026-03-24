FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:20-alpine

WORKDIR /app
RUN apk add --no-cache git curl bash

COPY package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev

COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY migrations/ ./migrations/

RUN mkdir -p workspaces/default

EXPOSE 3000 3001

CMD ["node", "dist/index.js"]
