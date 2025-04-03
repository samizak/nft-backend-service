    # Use an official Node.js runtime as a parent image
    FROM node:18-alpine AS builder

    WORKDIR /app

    # Copy package.json and package-lock.json
    COPY package*.json ./

    # Install dependencies
    RUN npm ci

    # Copy the rest of the application code
    COPY . .

    # Build the TypeScript code
    RUN npm run build

    # --- Production Stage ---
    FROM node:18-alpine

    WORKDIR /app

    # Copy built code and node_modules from builder stage
    COPY --from=builder /app/dist ./dist
    COPY --from=builder /app/node_modules ./node_modules
    COPY package*.json ./

    # Expose the port the app runs on (must match PORT env var)
    EXPOSE 3001

    # Define the command to run your app
    CMD [ "npm", "start" ]