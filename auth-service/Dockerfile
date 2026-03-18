FROM node:18-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy package files first (layer caching optimization)
COPY package*.json ./

# Install all dependencies (including devDependencies for nodemon)
RUN npm install && npm cache clean --force

# Copy source code
COPY . .

# Remove any local .env if accidentally copied
RUN rm -f .env

EXPOSE 3001

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
