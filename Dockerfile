FROM node:20-slim

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY docs ./docs

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["node", "server.js"]
