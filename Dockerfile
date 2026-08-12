FROM node:18-alpine

# FFmpeg इंस्टॉल करें (फ्री सर्वर के लिए जरूरी)
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
