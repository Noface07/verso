FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
RUN mkdir -p /data/files && chown -R node:node /data/files
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]