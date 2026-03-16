FROM node:18-bookworm

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      jq \
      tmux \
      python3 \
      python3-pip \
      bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package.json ./
COPY mcp-coordinator/package.json ./mcp-coordinator/
COPY sidecar/package.json ./sidecar/

# Install dependencies
RUN npm install --workspaces --include-workspace-root

# Copy remaining source
COPY . .

# Run install (registers MCP server, sets up hooks and commands)
RUN bash install.sh --mode full

EXPOSE 8080

CMD ["node", "sidecar/server/index.js"]
