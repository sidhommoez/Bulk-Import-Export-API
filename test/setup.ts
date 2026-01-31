import { DataType, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User, Article, Comment, ImportJob, ExportJob } from '../src/database/entities';

// Increase Jest timeout for e2e tests
jest.setTimeout(60000);

// Create in-memory PostgreSQL database
export async function createTestDataSource(): Promise<DataSource> {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  });

  // Register uuid-ossp extension functions
  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: DataType.uuid,
    implementation: () => uuidv4(),
  });

  // Register current_database function
  db.public.registerFunction({
    name: 'current_database',
    returns: DataType.text,
    implementation: () => 'test_db',
  });

  // Register version function
  db.public.registerFunction({
    name: 'version',
    returns: DataType.text,
    implementation: () => 'PostgreSQL 16.0 (pg-mem)',
  });

  // Register current_schema function
  db.public.registerFunction({
    name: 'current_schema',
    returns: DataType.text,
    implementation: () => 'public',
  });

  // Create enum types that pg-mem doesn't support natively
  db.public.none(`
    DO $$ BEGIN
      CREATE TYPE "user_role_enum" AS ENUM ('admin', 'manager', 'author', 'editor', 'reader');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  db.public.none(`
    DO $$ BEGIN
      CREATE TYPE "article_status_enum" AS ENUM ('draft', 'published', 'archived');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  db.public.none(`
    DO $$ BEGIN
      CREATE TYPE "import_job_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  db.public.none(`
    DO $$ BEGIN
      CREATE TYPE "export_job_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  db.public.none(`
    DO $$ BEGIN
      CREATE TYPE "resource_type_enum" AS ENUM ('users', 'articles', 'comments');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  db.public.none(`
    DO $$ BEGIN
      CREATE TYPE "export_format_enum" AS ENUM ('json', 'ndjson', 'csv');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  // Create TypeORM DataSource using pg-mem adapter
  const dataSource: DataSource = await db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [User, Article, Comment, ImportJob, ExportJob],
    synchronize: true,
    logging: false,
  });

  await dataSource.initialize();

  return dataSource;
}

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.API_KEY = ''; // Disable API key auth for tests
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.AWS_S3_BUCKET = 'bulk-import-export-test';
process.env.AWS_S3_ENDPOINT = process.env.AWS_S3_ENDPOINT || 'http://localhost:4566';
process.env.AWS_S3_FORCE_PATH_STYLE = 'true';

// Test utilities
export const testUtils = {
  generateUUID: (): string => {
    return uuidv4();
  },

  generateEmail: (): string => {
    return `test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
  },

  generateSlug: (): string => {
    return `test-article-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  },

  sleep: (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};
