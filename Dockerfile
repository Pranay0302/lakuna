FROM oven/bun:1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY . .

WORKDIR /app/visualizer
RUN bun install --frozen-lockfile
RUN bun run build

# Zero provides the optional paid Exa live-search service. It remains dormant
# unless ZERO_EXA_ENABLED=true and a Zero session is supplied at runtime.
RUN bun install -g @zeroxyz/cli@latest \
    && zero --help >/dev/null

WORKDIR /app
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    anthropic==0.97.0 \
    python-dotenv==1.2.2
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    torch

WORKDIR /app/visualizer

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "start"]
