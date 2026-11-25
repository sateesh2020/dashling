FROM node:26-alpine
RUN apk add --no-cache openssh-client-default && rm -rf /var/cache/apk/*
WORKDIR /app
COPY server ./server
COPY web ./web
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
