#!/bin/bash

# pg-smart-search Automated E2E Runner
# Requirements: docker, docker-compose, npm

echo "🚀 Starting Integration Test Environment..."
docker-compose -f docker-compose.test.yml up -d postgres-test

echo "⏳ Waiting for PostgreSQL to be ready..."
until docker exec $(docker ps -qf "name=postgres-test") pg_isready -U test_user -d test_db; do
  sleep 1
done

echo "🧪 Running Integration Tests..."
npm run test:integration

echo "🧹 Cleaning up..."
docker-compose -f docker-compose.test.yml down

echo "✅ E2E Pipeline Complete."
