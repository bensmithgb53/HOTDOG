# Use a Node.js LTS (Long Term Support) image as the base
FROM node:20-slim

# Install system dependencies required for Chromium (Puppeteer)
# These are common dependencies for headless Chrome
RUN apt-get update && apt-get install -y \
    chromium \
    fontconfig \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlm \
    fonts-kacst \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (or yarn.lock if you use yarn)
# This allows Docker to cache the npm install layer
COPY package.json package-lock.json ./

# Install Node.js dependencies
# --omit=dev prevents installing dev dependencies which are not needed in production
RUN npm install --omit=dev

# Copy the rest of your application code into the container
COPY . .

# Set environment variable for Puppeteer to find the system-installed Chromium
# 'puppeteer-real-browser' might use this, or it might look for 'chromium' directly.
# This is a common path for system-installed Chromium on Debian/Ubuntu-based images.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expose the port your application will run on
# Your index.js uses PORT from environment, otherwise defaults to 7000
EXPOSE 7000

# Command to run your application when the container starts
CMD ["npm", "start"]
