FROM node:18-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production && npm cache clean --force

COPY . .

RUN rm -f .env

EXPOSE 3006

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
