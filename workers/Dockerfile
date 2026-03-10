# workers/Dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

# Copy Prisma schema if your workers use it for DB updates
COPY prisma ./prisma/
RUN npx prisma generate

COPY . .

# We don't need EXPOSE or CMD here, because we will define the 
# start command directly in the docker-compose.yml file!