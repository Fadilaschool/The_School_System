FROM node:18-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./

RUN npm install && npm cache clean --force

COPY . .

RUN rm -f .env

EXPOSE 3003

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
