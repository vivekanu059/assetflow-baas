# api-gateway/Dockerfile
FROM node:22-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the Prisma schema and generate the client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy the rest of your source code
COPY . .

# Expose the port your Express server runs on
EXPOSE 5000

# Start the server
CMD ["npm", "start"]