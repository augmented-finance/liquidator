FROM node:16
ENV NODE_ENV=production
WORKDIR /app
COPY . .
RUN npm ci --production
RUN npm install -g cross-env
RUN npm run build
CMD [ "/app/liquidator-bot.sh" ]
