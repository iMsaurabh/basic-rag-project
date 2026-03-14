# Base image — Node.js 20 on slim Linux
# slim = smaller image size, only essential OS packages
FROM node:20-slim

# Set working directory inside container
# All subsequent commands run from here
WORKDIR /app

# Copy package files first — separate from source code
# This is a Docker optimization — if package.json hasn't changed
# Docker reuses cached node_modules layer instead of reinstalling
COPY package*.json ./

# Install only production dependencies
# --omit=dev skips devDependencies — smaller image
RUN npm install --omit=dev

# Copy rest of source code
# Done after npm install to maximize layer caching
COPY . .

# Document which port the app listens on
# This is informational — doesn't actually expose the port
EXPOSE 3000

# Command to run when container starts
CMD ["node", "server.js"]