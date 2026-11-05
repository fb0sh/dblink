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
# Mode-aware liveness: connection refused (stdio, no HTTP listener) => healthy;
# otherwise GET /healthz must return 200. Uses node only (no curl in node:22-alpine).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const net=require('net'),http=require('http');const port=Number(process.env.DBLINK_PORT||7331);const probe=net.connect({host:'127.0.0.1',port:port});probe.setTimeout(2000);probe.on('connect',()=>{probe.destroy();const req=http.get({host:'127.0.0.1',port:port,path:'/healthz',timeout:2000},(res)=>{res.resume();process.exit(res.statusCode===200?0:1);});req.on('timeout',()=>{req.destroy();process.exit(1);});req.on('error',()=>process.exit(1));});probe.on('timeout',()=>{probe.destroy();process.exit(1);});probe.on('error',(err)=>process.exit(err&&err.code==='ECONNREFUSED'?0:1));"]
ENTRYPOINT ["node", "dist/index.js"]
CMD ["stdio"]
