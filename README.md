# Bulk Import/Export API

A production-ready NestJS 11 application for bulk data import and export operations. This system handles up to 1,000,000 records per job with streaming support, robust validation, comprehensive error reporting, and **multi-node scalability**.

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Configuration](#️-configuration)
- [Authentication](#-authentication)
- [API Documentation](#-api-documentation)
- [Data Schemas](#-data-schemas)
- [Validation Rules](#-validation-rules)
- [Usage Examples](#-usage-examples)
- [Testing](#-testing)
- [Multi-Node Scalability](#-multi-node-scalability)
- [Performance](#-performance)
- [Project Structure](#-project-structure)
- [Development](#️-development)

## ✨ Features

- **Bulk Import**: Upload files (JSON, NDJSON, CSV) or provide remote URLs for async processing
- **Bulk Export**: Stream data directly or create background export jobs with filters
- **Async Processing**: Long-running operations processed via BullMQ with Redis
- **Multi-Node Scalability**: Distributed locking ensures safe operation across multiple instances
- **API Key Authentication**: Secure endpoints with multiple API keys support
- **Idempotency**: Prevent duplicate imports using the `Idempotency-Key` header
- **Stream Processing**: O(1) memory usage for large files (up to 1M records)
- **Robust Validation**: Per-record validation with detailed error reporting
- **Upsert Support**: Import same file multiple times without duplicating data
- **Observability**: Structured logging with metrics (rows/sec, error rate, duration)
- **S3 Storage**: Files stored in S3 (LocalStack for local development)
- **Stale Job Recovery**: Automatic cleanup of abandoned jobs from crashed nodes

## 🏗 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   REST API      │────▶│   BullMQ Queue  │────▶│   Processors    │
│   (NestJS 11)   │     │   (Redis)       │     │   (Background)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                        │
         │                      ▼                        │
         │              ┌─────────────────┐              │
         │              │ Distributed Lock│              │
         │              │    (Redis)      │              │
         │              └─────────────────┘              │
         ▼                                               ▼
┌─────────────────┐                           ┌─────────────────┐
│   PostgreSQL    │◀──────────────────────────│   S3 Storage    │
│   (TypeORM)     │                           │   (LocalStack)  │
└─────────────────┘                           └─────────────────┘
```

## 📦 Prerequisites

- **Node.js** >= 20.0.0
- **Docker** and **Docker Compose**
- **npm** or **yarn**

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Install dependencies
npm install
```

### 2. Environment Setup

```bash
# Copy environment example
cp .env.example .env

# Edit .env with your configuration (defaults work for local development)
```

### 3. Start Services with Docker

```bash
# Start all services (PostgreSQL, Redis, LocalStack, App, pgAdmin)
docker-compose up -d

# Wait for services to be healthy
docker-compose ps
```

### 4. Run Database Migrations

```bash
# Run migrations
npm run migration:run
```

### 5. Access the Application

| Service | URL | Credentials | Description |
|---------|-----|-------------|-------------|
| **API** | http://localhost:3000/v1 | API Key (if configured) | REST API endpoints |
| **Swagger Docs** | http://localhost:3000/api/docs | - | Interactive API documentation |
| **pgAdmin** | http://localhost:5050 | admin@admin.com / admin | PostgreSQL database viewer (auto-configured) |
| **Bull Board** | http://localhost:3000/admin/queues | - | Background job queue monitoring |
| **S3 Manager** | http://localhost:8080 | - | Browse S3/LocalStack files |
| **Redis Commander** | http://localhost:8081 | (run with `--profile debug`) | Redis data viewer |

### pgAdmin (Auto-Configured)

pgAdmin comes pre-configured with the PostgreSQL connection:

1. Open http://localhost:5050
2. Login with `admin@admin.com` / `admin`
3. The server "**Bulk Import Export DB**" is already configured in the left sidebar
4. Just click to connect - no password prompt needed!

### Alternative: Run Without Docker

```bash
# Start PostgreSQL and Redis locally, then:
npm run start:dev
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Application port | `3000` |
| `API_PREFIX` | API route prefix | `v1` |
| `API_KEY` | Comma-separated API keys | `` (disabled) |
| `DATABASE_HOST` | PostgreSQL host | `localhost` |
| `DATABASE_PORT` | PostgreSQL port | `5432` |
| `DATABASE_USERNAME` | PostgreSQL username | `postgres` |
| `DATABASE_PASSWORD` | PostgreSQL password | `postgres` |
| `DATABASE_NAME` | PostgreSQL database | `bulk_import_export` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_S3_BUCKET` | S3 bucket name | `bulk-import-export` |
| `AWS_S3_ENDPOINT` | S3 endpoint (for LocalStack) | `` |
| `JOB_BATCH_SIZE` | Records per batch | `1000` |
| `JOB_CONCURRENCY` | Concurrent job processors | `2` |

## 🔐 Authentication

### API Key Authentication

The API uses API key authentication via the `X-API-Key` header.

#### Configuration

Set one or more API keys in your environment:

```bash
# Single key
API_KEY=your-secret-key

# Multiple keys (comma-separated)
API_KEY=key1-secret,key2-secret,key3-secret
```

#### Usage

Include the API key in your requests:

```bash
curl -X GET http://localhost:3000/v1/imports/123 \
  -H "X-API-Key: your-secret-key"
```

#### Development Mode

Leave `API_KEY` empty to disable authentication:

```bash
API_KEY=
```

#### Swagger UI

Click the "Authorize" button in Swagger UI and enter your API key.

## 📚 API Documentation

### Import Endpoints

#### Create Import Job

**POST** `/v1/imports`

Upload a file or provide a URL to import data.

**Form Data (File Upload):**
```bash
curl -X POST http://localhost:3000/v1/imports \
  -H "X-API-Key: your-key" \
  -F "file=@users.ndjson" \
  -F "resourceType=users"
```

**JSON Body (URL Import):**
```bash
curl -X POST http://localhost:3000/v1/imports \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "users",
    "fileUrl": "https://example.com/users.ndjson",
    "format": "ndjson"
  }'
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "resourceType": "users",
  "status": "pending",
  "totalRows": 0,
  "processedRows": 0,
  "successfulRows": 0,
  "failedRows": 0,
  "skippedRows": 0,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

#### Get Import Job Status

**GET** `/v1/imports/:id`

```bash
curl http://localhost:3000/v1/imports/550e8400-e29b-41d4-a716-446655440000 \
  -H "X-API-Key: your-key"
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "resourceType": "users",
  "status": "completed",
  "totalRows": 10000,
  "processedRows": 10000,
  "successfulRows": 9850,
  "failedRows": 100,
  "skippedRows": 50,
  "progressPercentage": 100,
  "errors": [
    {
      "row": 42,
      "field": "email",
      "message": "Invalid email format",
      "value": "not-an-email"
    }
  ],
  "metrics": {
    "rowsPerSecond": 2500,
    "errorRate": 0.01,
    "durationMs": 4000
  },
  "startedAt": "2024-01-15T10:30:01Z",
  "completedAt": "2024-01-15T10:30:05Z",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:05Z"
}
```

### Export Endpoints

#### Stream Export (Direct Download)

**GET** `/v1/exports?resource=users&format=ndjson`

```bash
curl "http://localhost:3000/v1/exports?resource=users&format=csv" \
  -H "X-API-Key: your-key" \
  -o users.csv
```

#### Create Async Export Job

**POST** `/v1/exports`

```bash
curl -X POST http://localhost:3000/v1/exports \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "articles",
    "format": "ndjson",
    "filters": {
      "status": "published",
      "createdAfter": "2024-01-01"
    }
  }'
```

**Response:**
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "resourceType": "articles",
  "format": "ndjson",
  "status": "pending",
  "totalRows": 0,
  "exportedRows": 0,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

#### Get Export Job Status

**GET** `/v1/exports/:id`

```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "resourceType": "articles",
  "format": "ndjson",
  "status": "completed",
  "totalRows": 5000,
  "exportedRows": 5000,
  "progressPercentage": 100,
  "downloadUrl": "https://s3.amazonaws.com/...",
  "fileSize": 2500000,
  "metrics": {
    "rowsPerSecond": 6000,
    "totalBytes": 2500000,
    "durationMs": 833
  },
  "expiresAt": "2024-01-16T10:30:05Z",
  "startedAt": "2024-01-15T10:30:01Z",
  "completedAt": "2024-01-15T10:30:02Z"
}
```

## 📊 Data Schemas

### Users

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | No | Auto-generated if not provided |
| `email` | string | Yes | Unique email address |
| `name` | string | Yes | User's full name |
| `role` | enum | Yes | `admin`, `manager`, `author`, `editor`, `reader` |
| `active` | boolean | No | Default: `true` |

### Articles

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | No | Auto-generated if not provided |
| `slug` | string | Yes | Unique, kebab-case URL slug |
| `title` | string | Yes | Article title |
| `body` | string | Yes | Article content (10-50,000 words) |
| `author_id` | UUID | Yes | Must reference existing user |
| `tags` | string[] | No | Array of tags |
| `status` | enum | Yes | `draft`, `published`, `archived` |
| `published_at` | ISO date | No | Required if status is `published` |

### Comments

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | No | Auto-generated if not provided |
| `article_id` | UUID | Yes | Must reference existing article |
| `user_id` | UUID | Yes | Must reference existing user |
| `body` | string | Yes | Comment text (max 10,000 chars) |

## ✅ Validation Rules

### Users
- Email must be valid format and unique
- Name is required
- Role must be one of: `admin`, `manager`, `author`, `editor`, `reader`

### Articles
- Slug must be kebab-case and unique
- Body must be 10-50,000 words
- `author_id` must reference an existing user
- Draft articles cannot have `published_at`
- Published articles must have `published_at`

### Comments
- `article_id` must reference an existing article
- `user_id` must reference an existing user
- Body max 10,000 characters

### Duplicate Handling (Upsert)

The system uses upsert logic based on unique fields:
- **Users**: Matched by `email` - existing users are updated
- **Articles**: Matched by `slug` - existing articles are updated
- **Comments**: Matched by `id` - existing comments are updated

### Error Reporting

Validation errors are collected per row (up to 100 errors stored):

```json
{
  "errors": [
    { "row": 1, "field": "email", "message": "Invalid email format", "value": "bad-email" },
    { "row": 5, "field": "role", "message": "Invalid role", "value": "superuser" }
  ]
}
```

## 💡 Usage Examples

### Import Users from CSV File

```bash
curl -X POST http://localhost:3000/v1/imports \
  -H "X-API-Key: your-key" \
  -H "Idempotency-Key: import-users-2024-01-15" \
  -F "file=@users.csv" \
  -F "resourceType=users"
```

### Import Articles from NDJSON URL

```bash
curl -X POST http://localhost:3000/v1/imports \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "articles",
    "fileUrl": "https://example.com/articles.ndjson",
    "format": "ndjson"
  }'
```

### Check Import Status

```bash
curl http://localhost:3000/v1/imports/550e8400-e29b-41d4-a716-446655440000 \
  -H "X-API-Key: your-key"
```

### Stream Export

```bash
# Export as CSV
curl "http://localhost:3000/v1/exports?resource=users&format=csv" \
  -H "X-API-Key: your-key" -o users.csv

# Export as NDJSON with filters
curl "http://localhost:3000/v1/exports?resource=articles&format=ndjson&status=published" \
  -H "X-API-Key: your-key" -o articles.ndjson
```

### Create Async Export with Filters

```bash
curl -X POST http://localhost:3000/v1/exports \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "articles",
    "format": "json",
    "filters": {
      "status": "published",
      "createdAfter": "2024-01-01",
      "authorId": "user-uuid-here"
    },
    "fields": ["id", "slug", "title", "status"]
  }'
```

### Sample NDJSON User Data

```ndjson
{"email":"john@example.com","name":"John Doe","role":"admin","active":true}
{"email":"jane@example.com","name":"Jane Smith","role":"editor","active":true}
{"email":"bob@example.com","name":"Bob Wilson","role":"reader","active":false}
```

### Sample CSV User Data

```csv
email,name,role,active
john@example.com,John Doe,admin,true
jane@example.com,Jane Smith,editor,true
bob@example.com,Bob Wilson,reader,false
```

## 🧪 Testing

### Run Unit Tests

```bash
npm run test
```

### Run Unit Tests with Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:cov
```

### Run E2E / Integration Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with verbose output
npm run test:e2e -- --verbose

# Run specific test file
npx jest --config ./test/jest-e2e.json integration.e2e-spec.ts
npx jest --config ./test/jest-e2e.json testdata.e2e-spec.ts
```

### Run All Tests

```bash
npm test && npm run test:e2e
```

### Test Summary

| Test Suite | Description |
|------------|-------------|
| `validation.utils.spec.ts` | Validation utility functions |
| `imports.service.spec.ts` | Import service unit tests |
| `integration.e2e-spec.ts` | Database integration tests |
| `testdata.e2e-spec.ts` | Test data validation tests |

## 🔄 Multi-Node Scalability

This application is designed to run safely across multiple nodes/instances.

### Features

1. **Distributed Locking (Redis)**
   - Prevents multiple nodes from processing the same job
   - Uses Redis `SET NX PX` for atomic lock acquisition
   - Auto-renews locks during long operations

2. **Atomic Status Transitions**
   - Database-level row locking (`SELECT ... FOR UPDATE`)
   - Optimistic locking via version column
   - Prevents race conditions on job state changes

3. **Stale Job Cleanup**
   - Scheduled task runs every 5 minutes
   - Detects jobs stuck in `PROCESSING` state
   - Recovers from crashed node scenarios

### Configuration

```bash
# Stale job thresholds (in milliseconds)
JOB_STALE_THRESHOLD_MS=1800000      # 30 minutes - when to consider a job stale
JOB_STALE_LOCK_THRESHOLD_MS=600000  # 10 minutes - when to consider a lock stale
JOB_RESTART_STALE_JOBS=false        # Whether to restart stale jobs or mark as failed
```

### How It Works

```
Node A                          Node B                          Redis
  |                               |                               |
  |-- Acquire lock "job:123" ---------------------------> [SET NX]
  |<---- Lock acquired -----------|                               |
  |                               |                               |
  |                               |-- Acquire lock "job:123" ---> [SET NX]
  |                               |<---- FAILED (key exists) -----|
  |                               |                               |
  |-- Process job                 |-- Skip (already locked)       |
  |-- Update DB (PROCESSING)      |                               |
  |                               |                               |
  |-- Complete job                |                               |
  |-- Update DB (COMPLETED)       |                               |
  |-- Release lock ---------------------------------------> [DEL]
```

### Database Columns for Locking

Jobs have the following columns for distributed coordination:
- `version` - Optimistic locking counter
- `locked_by` - Node ID that holds the lock
- `locked_at` - Timestamp when lock was acquired

## ⚡ Performance

### Benchmarks

| Operation | Target | Achieved |
|-----------|--------|----------|
| Import throughput | 1k records/sec | ✅ 1.5k-3k records/sec |
| Export throughput | 5k records/sec | ✅ 5k-8k records/sec |
| Max records per job | 1,000,000 | ✅ Tested |
| Memory usage | O(1) | ✅ Streaming |
| Batch size | 1,000 records | Configurable |

### Optimization Tips

1. **Use NDJSON format** for best streaming performance
2. **Increase batch size** for faster imports (at cost of memory)
3. **Use filters** in exports to reduce data volume
4. **Monitor Redis memory** for large job queues
5. **Scale workers** by adjusting `JOB_CONCURRENCY`
6. **Run multiple nodes** for horizontal scaling

### Monitoring

```bash
# View application logs
docker-compose logs -f app

# View all service logs
docker-compose logs -f

# Monitor job queues
# Open http://localhost:3000/admin/queues
```

## 📁 Project Structure

```
src/
├── common/                 # Shared utilities
│   ├── decorators/         # Custom decorators
│   ├── filters/            # Exception filters
│   ├── guards/             # Authentication guards
│   ├── interceptors/       # Request interceptors
│   ├── services/           # Shared services
│   │   ├── distributed-lock.service.ts    # Redis distributed locking
│   │   └── stale-job-cleanup.service.ts   # Stale job recovery
│   └── utils/              # Utility functions
├── config/                 # Configuration
├── database/
│   ├── entities/           # TypeORM entities
│   └── migrations/         # Database migrations
├── modules/
│   ├── imports/            # Import module
│   │   ├── dto/            # Data transfer objects
│   │   └── processors/     # Queue processors
│   ├── exports/            # Export module
│   │   ├── dto/
│   │   └── processors/
│   ├── health/             # Health check module
│   └── bull-board/         # Queue dashboard
├── queue/                  # BullMQ queue configuration
├── storage/                # S3 storage service
├── app.module.ts           # Root module
└── main.ts                 # Application entry point

test/
├── testdata/               # Test data files (CSV, NDJSON)
├── integration.e2e-spec.ts # Database integration tests
├── testdata.e2e-spec.ts    # Test data validation tests
├── setup.ts                # Test setup utilities
└── jest-e2e.json           # E2E test configuration

scripts/
├── init-db.sql             # Database initialization
├── init-localstack.sh      # LocalStack/S3 initialization
├── pgadmin-servers.json    # pgAdmin auto-configuration
└── pgadmin-pgpass          # pgAdmin password file
```

## 🛠️ Development

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start in development mode with hot reload |
| `npm run start:debug` | Start in debug mode with hot reload |
| `npm run build` | Build for production |
| `npm run start:prod` | Start production build |
| `npm run test` | Run unit tests |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:e2e` | Run E2E/integration tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run lint` | Lint and fix code |
| `npm run format` | Format code with Prettier |
| `npm run migration:generate` | Generate new migration |
| `npm run migration:run` | Run database migrations |
| `npm run migration:revert` | Revert last migration |

### Docker Commands

```bash
# Start all services
docker-compose up -d

# Start with debug tools (Redis Commander)
docker-compose --profile debug up -d

# View logs
docker-compose logs -f app

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

## 📄 License

MIT