FROM node:20-slim

# Python + the official Fivetran MCP server, installed into a venv.
# TrustGate spawns this over stdio at runtime to gather Fivetran evidence.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/fivetran/fivetran-mcp /opt/fivetran-mcp \
 && python3 -m venv /opt/fivetran-mcp-venv \
 && /opt/fivetran-mcp-venv/bin/pip install --no-cache-dir /opt/fivetran-mcp

ENV FIVETRAN_MCP_CMD=/opt/fivetran-mcp-venv/bin/python
ENV FIVETRAN_MCP_ARGS=/opt/fivetran-mcp/server.py
ENV FIVETRAN_MCP_CWD=/opt/fivetran-mcp
ENV FIVETRAN_ALLOW_WRITES=false

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY docs ./docs

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["node", "server.js"]
