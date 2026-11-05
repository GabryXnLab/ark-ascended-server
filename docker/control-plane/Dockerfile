# Immagine del control plane: backend Express + PWA buildata servita staticamente.
# Build: docker build -f docker/control-plane/Dockerfile -t ark-ascended-control-plane .
# (contesto = root del repo)
#
# Un runner ARM64. Gli stage applicativi restano su
# $BUILDPLATFORM e vengono compilati una volta sola in modo nativo, perché il
# loro output TypeScript/Vite è indipendente dall'architettura. Lo stage finale
# non esegue binari, quindi buildx assembla anche amd64 senza QEMU.

# --- Stage 1: build PWA -------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:20-alpine AS pwa-build
WORKDIR /build
COPY control-plane/pwa/package.json control-plane/pwa/package-lock.json ./
RUN npm ci
COPY control-plane/pwa .
RUN npm run build

# --- Stage 2: build backend ---------------------------------------------------
FROM --platform=$BUILDPLATFORM node:20-alpine AS backend-build
WORKDIR /build
COPY control-plane/backend/package.json control-plane/backend/package-lock.json ./
RUN npm ci
COPY control-plane/backend/tsconfig.json ./
COPY control-plane/backend/src ./src
RUN npm run build

# Le dipendenze production sono solo JavaScript (nessun addon *.node): possono
# essere installate una volta sull'architettura del runner e copiate in entrambi
# i runtime. Così la gamba amd64 non esegue npm/Node sotto QEMU.
FROM --platform=$BUILDPLATFORM node:20-alpine AS backend-production
WORKDIR /build
COPY control-plane/backend/package.json control-plane/backend/package-lock.json ./
RUN npm ci --omit=dev \
  && test -z "$(find node_modules -type f -name '*.node' -print -quit)"

# Mantiene l'UID/GID (100:101) usato dall'utente `arksa` nelle immagini già
# distribuite. I volumi Docker conservano gli owner numerici: passare al nuovo
# utente `node` (1000:1000) renderebbe il volume di produzione illeggibile.
# Il marker è innocuo e permette di preparare la directory senza un RUN nello
# stage target.
FROM --platform=$BUILDPLATFORM alpine:3.22 AS runtime-layout
RUN mkdir -p /data && touch /data/.arksa-volume

# --- Stage 4: runtime (piattaforma target, nessun RUN emulato) -----------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    BIND=0.0.0.0 \
    DATA_DIR=/data \
    PWA_DIST=/app/pwa

COPY control-plane/backend/package.json control-plane/backend/package-lock.json ./
COPY --from=backend-production /build/node_modules ./node_modules
COPY --from=backend-build /build/dist ./dist
COPY --from=pwa-build /build/dist ./pwa
COPY --from=runtime-layout --chown=100:101 /data /data

# Lo SHA cambia a ogni commit: dichiararlo soltanto dopo installazione dipendenze
# e build evita di invalidare tutti gli strati costosi per il solo metadato.
ARG SOURCE_REVISION=dev
ENV APP_REVISION=${SOURCE_REVISION}
USER 100:101
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "dist/index.js"]
