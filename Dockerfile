# Use the official Bun image
FROM oven/bun:1 as base
WORKDIR /usr/src/app

# Development stage
FROM base as development
COPY package.json bun.lock ./
RUN bun install
COPY . .
CMD ["bun", "run", "src/index.ts"]

# Build stage
FROM base as build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

# Production stage
FROM base as release
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/src ./src
COPY --from=build /usr/src/app/package.json ./package.json
COPY --from=build /usr/src/app/drizzle ./drizzle
COPY --from=build /usr/src/app/public ./public

USER bun
EXPOSE 3000
CMD ["sh", "-c", "bun run src/db/migrate.ts && bun run src/index.ts"]
