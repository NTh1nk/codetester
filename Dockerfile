FROM node:20-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS production
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --production
COPY --from=builder /usr/src/app/lib ./lib
ENV NODE_ENV=production
EXPOSE 3000
CMD [ "npm", "start" ]
