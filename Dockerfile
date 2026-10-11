# Atropos public demo. Keys come from `fly secrets`, never from the image.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN node scripts/build-tools.js
ENV ATROPOS_PUBLIC=1 PORT=8080 AGENT_EVERY_MIN=60 NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
