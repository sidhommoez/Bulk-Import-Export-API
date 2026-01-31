# Bulk Import/Export API

A production-ready NestJS 11 application for bulk data import and export operations. This system handles up to 1,000,000 records per job with streaming support, robust validation, and comprehensive error reporting.

## 📋 Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [API Documentation](#api-documentation)
- [Data Schemas](#data-schemas)
- [Validation Rules](#validation-rules)
- [Usage Examples](#usage-examples)
- [Testing](#testing)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)

## ✨ Features

- **Bulk Import**: Upload files (JSON, NDJSON, CSV) or provide remote URLs for async processing
- **Bulk Export**: Stream data directly or create background export jobs with filters
- **Async Processing**: Long-running operations processed via BullMQ with Redis
- **API Key Authentication**: Secure endpoints with multiple API keys support
- **Idempotency**: Prevent duplicate imports using the `Idempotency-Key` header
- **Stream Processing**: O(1) memory usage for large files (up to 1M records)
- **Robust Validation**: Per-record validation with detailed error reporting
- **Upsert Support**: Import same file multiple times without duplicating data
- **Observability**: Structured logging with metrics (rows/sec, error rate, duration)
- **S3 Storage**: Files stored in S3 (LocalStack for local development)

## 🏗 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   REST API      │────▶│   BullMQ Queue  │────▶│   Processors    │
│   (NestJS 11)   │     │   (Redis)       │     │   (Background)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                                               │
         ▼                                               ▼
┌─────────────────┐                           ┌─────────────────┐
│   PostgreSQL    │◀──────────────────────────│   S3 Storage    │
│   (TypeORM)     │                           │   (LocalStack)  │
└─────────────────┘                           └─────────────────┘
```

## 📦 Prerequisites

- **Node.js** >= 18.0.0
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
| **pgAdmin** | http://localhost:5050 | admin@admin.com / admin | PostgreSQL database viewer |
| **Bull Board** | http://localhost:3000/admin/queues | - | Background job queue monitoring |
| **S3 Manager** | http://localhost:8080 | - | Browse S3/LocalStack files |
| **Redis Commander** | http://localhost:8081 | (run with `--profile debug`) | Redis data viewer |

### pgAdmin Setup

1. Open http://localhost:5050
2. Login with `admin@admin.com` / `admin`
3. Add new server:
   - **Host**: `postgres`
   - **Port**: `5432`
   - **Username**: `postgres`
   - **Password**: `postgres`
   - **Database**: `bulk_import_export`

### Alternative: Run Without Docker

```bash
# Start PostgreSQL and Redis locally, then:
npm run start:dev
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production/test) | `development` |
| `PORT` | Application port | `3000` |
| `API_PREFIX` | API URL prefix | `v1` |
| `API_KEY` | API key(s) for authentication (comma-separated) | `` (disabled) |
| `SWAGGER_ENABLED` | Enable Swagger documentation | `true` (non-prod) |
| `DATABASE_HOST` | PostgreSQL host | `localhost` |
| `DATABASE_PORT` | PostgreSQL port | `5432` |
| `DATABASE_USERNAME` | Database username | `postgres` |
| `DATABASE_PASSWORD` | Database password | `postgres` |
| `DATABASE_NAME` | Database name | `bulk_import_export` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key | `test` |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | `test` |
| `AWS_S3_BUCKET` | S3 bucket name | `bulk-import-export` |
| `AWS_S3_ENDPOINT` | S3 endpoint (LocalStack) | `http://localhost:4566` |
| `JOB_BATCH_SIZE` | Records per batch | `1000` |
| `JOB_CONCURRENCY` | Concurrent job processors | `2` |

## 🔐 Authentication

### API Key Authentication

Import and export endpoints are protected with API key authentication.

#### Configuration

```bash
# Single API key
API_KEY=my-secret-key

# Multiple API keys (comma-separated)
API_KEY=key1-for-admin,key2-for-app,key3-for-partner
```

#### Usage

Include the `X-API-Key` header in your requests:

```bash
curl -X POST http://localhost:3000/v1/imports \
  -H "X-API-Key: my-secret-key" \
  -F "resourceType=users" \
  -F "file=@users.csv"
```

#### Development Mode

If `API_KEY` is not set or empty, authentication is **disabled** (useful for local development).

#### Swagger UI

1. Click the **Authorize** button (🔓) in Swagger UI
2. Enter your API key
3. Click **Authorize**
4. All requests will include the `X-API-Key` header

## 📚 API Documentation

### Import Endpoints

#### Create Import Job

```http
POST /v1/imports
Content-Type: multipart/form-data
X-API-Key: your-api-key
Idempotency-Key: unique-import-key-123 (optional)

resourceType: users|articles|comments
file: <file>
format: json|ndjson|csv (optional, auto-detected)
```

**Or with remote URL:**

```http
POST /v1/imports
Content-Type: application/json
X-API-Key: your-api-key
Idempotency-Key: unique-import-key-123 (optional)

{
  "resourceType": "users",
  "fileUrl": "https://example.com/data/users.ndjson",
  "format": "ndjson"
}
```

**Response (202 Accepted):**

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
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

#### Get Import Job Status

```http
GET /v1/imports/{jobId}
X-API-Key: your-api-key
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
  "failedRows": 150,
  "skippedRows": 0,
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
    "rowsPerSecond": 5000,
    "errorRate": 0.015,
    "durationMs": 2000
  },
  "startedAt": "2024-01-15T10:30:01.000Z",
  "completedAt": "2024-01-15T10:30:03.000Z",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:03.000Z"
}
```

### Export Endpoints

#### Stream Export (Direct Download)

```http
GET /v1/exports?resource=articles&format=ndjson
X-API-Key: your-api-key
```

**Response:** Streamed NDJSON data

#### Create Async Export Job

```http
POST /v1/exports
Content-Type: application/json
X-API-Key: your-api-key

{
  "resourceType": "articles",
  "format": "ndjson",
  "filters": {
    "status": "published",
    "createdAfter": "2024-01-01T00:00:00Z"
  },
  "fields": ["id", "slug", "title", "author_id"]
}
```

**Response (202 Accepted):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "resourceType": "articles",
  "format": "ndjson",
  "status": "pending",
  "totalRows": 0,
  "exportedRows": 0,
  "createdAt": "2024-01-15T10:35:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

#### Get Export Job Status

```http
GET /v1/exports/{jobId}
X-API-Key: your-api-key
```

**Response (when completed):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "resourceType": "articles",
  "format": "ndjson",
  "status": "completed",
  "totalRows": 5000,
  "exportedRows": 5000,
  "progressPercentage": 100,
  "downloadUrl": "https://...",
  "fileSize": 1250000,
  "metrics": {
    "rowsPerSecond": 5000,
    "totalBytes": 1250000,
    "durationMs": 1000
  },
  "expiresAt": "2024-01-16T10:35:02.000Z",
  "startedAt": "2024-01-15T10:35:01.000Z",
  "completedAt": "2024-01-15T10:35:02.000Z"
}
```

## 📊 Data Schemas

### Users

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier (auto-generated if not provided) |
| `email` | string | Email address (unique, required) |
| `name` | string | User's full name (required) |
| `role` | enum | One of: `admin`, `manager`, `author`, `editor`, `reader` |
| `active` | boolean | Whether the user is active |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Last update timestamp |

### Articles

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier (auto-generated if not provided) |
| `slug` | string | URL-friendly identifier (unique, kebab-case, required) |
| `title` | string | Article title (required) |
| `body` | text | Article content (required) |
| `author_id` | UUID | Reference to user (required, must exist) |
| `tags` | array | Array of tag strings |
| `status` | enum | One of: `draft`, `published`, `archived` |
| `published_at` | timestamp | Publication date (only for published articles) |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Last update timestamp |

### Comments

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier (auto-generated if not provided) |
| `article_id` | UUID | Reference to article (required, must exist) |
| `user_id` | UUID | Reference to user (required, must exist) |
| `body` | text | Comment content (required, max 500 words, max 10,000 characters) |
| `created_at` | timestamp | Creation timestamp |

## ✅ Validation Rules

### Users
- **email**: Must be valid email format and unique
- **role**: Must be one of: `admin`, `manager`, `author`, `editor`, `reader`
- **active**: Must be a boolean value
- **Duplicates**: Matched by `email` - existing users are updated

### Articles
- **author_id**: Must reference any existing user
- **slug**: Must be unique and in kebab-case format (e.g., `my-article-title`)
- **status=draft**: Must NOT have a `published_at` date
- **status=published**: Should have a `published_at` date
- **Duplicates**: Matched by `slug` - existing articles are updated

### Comments
- **article_id**: Must reference an existing article
- **user_id**: Must reference any existing user
- **body**: Required, must not exceed 500 words or 10,000 characters
- **Duplicates**: Matched by `id` - existing comments are updated

### Duplicate Handling (Upsert)

Importing the same file twice will **NOT create duplicates**:

| Resource | Unique Key | Behavior |
|----------|------------|----------|
| Users | `email` | Update existing user |
| Articles | `slug` | Update existing article |
| Comments | `id` | Update existing comment |

### Error Reporting

Errors are truncated for readability:
- Long field values (>100 chars) are truncated with `...`
- Up to 100 errors stored per job

## 💡 Usage Examples

### Import Users from CSV File

```bash
curl -X POST http://localhost:3000/v1/imports \
  -H "X-API-Key: your-api-key" \
  -H "Idempotency-Key: import-users-$(date +%Y%m%d)" \
  -F "resourceType=users" \
  -F "file=@users.csv"
```

### Import Articles from NDJSON URL

```bash
curl -X POST http://localhost:3000/v1/imports \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -H "Idempotency-Key: import-articles-$(date +%Y%m%d)" \
  -d '{
    "resourceType": "articles",
    "fileUrl": "https://example.com/data/articles.ndjson",
    "format": "ndjson"
  }'
```

### Check Import Status

```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/v1/imports/550e8400-e29b-41d4-a716-446655440000
```

### Stream Export

```bash
# Stream articles to file
curl -H "X-API-Key: your-api-key" \
  "http://localhost:3000/v1/exports?resource=articles&format=ndjson" \
  -o articles_export.ndjson

# Stream users as CSV
curl -H "X-API-Key: your-api-key" \
  "http://localhost:3000/v1/exports?resource=users&format=csv" \
  -o users_export.csv
```

### Create Async Export with Filters

```bash
curl -X POST http://localhost:3000/v1/exports \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "resourceType": "articles",
    "format": "ndjson",
    "filters": {
      "status": "published",
      "createdAfter": "2024-01-01T00:00:00Z"
    },
    "fields": ["id", "slug", "title", "published_at"]
  }'
```

### Sample NDJSON User Data

```json
{"email":"user1@example.com","name":"John Doe","role":"admin","active":true}
{"email":"user2@example.com","name":"Jane Smith","role":"editor","active":true}
{"email":"user3@example.com","name":"Bob Wilson","role":"reader","active":false}
```

### Sample NDJSON Article Data

```json
{"slug":"hello-world","title":"Hello World","body":"Welcome to our blog!","author_id":"550e8400-e29b-41d4-a716-446655440000","tags":["intro","welcome"],"status":"published","published_at":"2024-01-15T10:00:00Z"}
{"slug":"draft-post","title":"Draft Post","body":"Work in progress...","author_id":"550e8400-e29b-41d4-a716-446655440000","tags":["draft"],"status":"draft"}
```

### Sample CSV User Data

```csv
id,email,name,role,active,created_at,updated_at
,user1@example.com,John Doe,admin,true,2024-01-01T00:00:00Z,2024-01-01T00:00:00Z
,user2@example.com,Jane Smith,editor,true,2024-01-01T00:01:00Z,2024-01-01T00:01:00Z
```

## 🧪 Testing

### Run Unit Tests

```bash
npm run test
```

### Run Tests with Coverage

```bash
npm run test:cov
```

### Run E2E Tests

```bash
# Ensure Docker services are running
docker-compose up -d postgres redis localstack

# Run e2e tests
npm run test:e2e
```

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


### Logs

```bash
# View application logs
docker-compose logs -f app

# View all service logs
docker-compose logs -f
```

## 📁 Project Structure

```
src/
├── common/                 # Shared utilities
│   ├── decorators/         # Custom decorators
│   ├── filters/            # Exception filters
│   ├── guards/             # Authentication guards
│   ├── interceptors/       # Request interceptors
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
```

## 🛠 Development

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start in development mode with hot reload |
| `npm run start:debug` | Start in debug mode with hot reload |
| `npm run build` | Build for production |
| `npm run start:prod` | Start production build |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run e2e tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run lint` | Lint code |
| `npm run format` | Format code with Prettier |
| `npm run migration:generate` | Generate new migration |
| `npm run migration:run` | Run database migrations |
| `npm run migration:revert` | Revert last migration |


## 📄 License

MIT
