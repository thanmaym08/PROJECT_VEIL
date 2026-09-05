FROM node:20-slim

# Install build dependencies for better-sqlite3 native module
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for Docker caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy server code
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
