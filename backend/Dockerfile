FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages 'kaggle==1.8.3'

COPY package*.json ./
RUN npm install

COPY src ./src
COPY data ./data

EXPOSE 3001

CMD ["npm", "start"]
