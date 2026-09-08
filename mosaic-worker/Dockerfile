# Optional Dockerfile. Railway will use Nixpacks by default; this is here
# so the service can also run on Fly / Render / a plain VM without changes.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --include=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# RAW (DNG / Apple ProRAW) support: dcraw_emu comes from libraw-bin,
# exiftool pulls the embedded full-size preview.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libraw-bin libimage-exiftool-perl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 8080
CMD ["node", "dist/index.js"]
