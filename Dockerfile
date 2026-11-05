# Build stage: full dependency tree + TypeScript compilation.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies + compiled output only.
FROM node:22-alpine
ENV NODE_ENV=production \
    DBLINK_BIND=0.0.0.0 \
    DBLINK_PORT=7331
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 7331
ENTRYPOINT ["node", "dist/index.js"]
CMD ["stdio"]
