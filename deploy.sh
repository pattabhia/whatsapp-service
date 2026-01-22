#!/bin/bash

# Azure Custom Deployment Script for WhatsApp Service
# This script ensures the backend folder is built correctly while preserving the services folder structure

set -e

echo "Starting custom deployment for WhatsApp Service..."

# Navigate to backend directory where package.json is located
cd backend

echo "Installing dependencies in backend folder..."
npm install --production

echo "Deployment complete. The app will start from backend folder using 'npm start'."

