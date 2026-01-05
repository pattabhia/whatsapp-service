# WhatsApp Adapter

A production-ready middleware service that connects WhatsApp Business API to the HaiIndexer AI system. Acts as a stateless integration layer for message flow, normalization, and delivery.

## Status

✅ **Production Ready** - 95% Compliance

All critical features implemented including circuit breaker, retry logic, rate limiting, idempotency, message splitting, and comprehensive error handling.

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- Redis (optional, recommended for multi-instance deployments)

### Installation

```bash
cd backend
npm install
```

### Configuration

Set required environment variables:

```bash
export WHATSAPP_API_TOKEN="your_token"
export WHATSAPP_PHONE_NUMBER_ID="your_phone_id"
export WEBHOOK_VERIFY_TOKEN="your_verify_token"
export HAIINDEXER_API_URL="https://api.haiindexer.com"

# Recommended
export WHATSAPP_APP_SECRET="your_app_secret"
export REDIS_URL="redis://localhost:6379"  # Optional
```

### Run

```bash
# Validate configuration
node backend/test-setup.js

# Start server
node backend/server.js
```

### Verify

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

## Features

### Core Features
- ✅ WhatsApp webhook handling
- ✅ Message normalization
- ✅ HaiIndexer API integration
- ✅ Error handling with user feedback

### Production Features
- ✅ **Circuit Breaker** - Prevents cascading failures
- ✅ **Retry Logic** - Exponential backoff for API calls
- ✅ **Rate Limiting** - Redis-based with in-memory fallback
- ✅ **Idempotency** - Prevents duplicate processing
- ✅ **Message Splitting** - Handles long messages intelligently
- ✅ **Health Checks** - Kubernetes-ready endpoints
- ✅ **Structured Logging** - JSON logs with correlation IDs
- ✅ **Webhook Signature Validation** - Security protection

## Architecture Diagrams

### Integration Architecture Diagram

See [Implementation Summary](docs/IMPLEMENTATION_SUMMARY.md) for detailed architecture.

## Documentation

- **[Implementation Summary](docs/IMPLEMENTATION_SUMMARY.md)** - Complete implementation overview
- **[Audit Summary](docs/AUDIT_SUMMARY.md)** - Architecture audit and compliance
- **[Architecture Diagrams](docs/)** - Integration and sequence diagrams

## API Endpoints

- `GET /webhook` - Webhook verification
- `POST /webhook` - Message receiving endpoint
- `GET /health` - Health check
- `GET /ready` - Readiness probe
- `GET /live` - Liveness probe

## Technology Stack

- **Runtime**: Node.js >= 18.0.0
- **Framework**: Express.js
- **Cache**: Redis (optional, ioredis)
- **Deployment**: Vercel-ready, Docker/Kubernetes compatible

## Status


- All critical features implemented
- Comprehensive error handling
- Production-grade reliability features
- Health checks and monitoring
- Configuration validation

See [Audit Summary](docs/AUDIT_SUMMARY.md) for detailed compliance report.

## Contributing

This is a production service. Changes should be tested and validated before deployment.
