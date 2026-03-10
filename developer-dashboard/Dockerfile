# developer-dashboard/Dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build the Next.js application for production
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]