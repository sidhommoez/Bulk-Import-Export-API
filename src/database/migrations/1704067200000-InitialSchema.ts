import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1704067200000 implements MigrationInterface {
  name = 'InitialSchema1704067200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable uuid-ossp extension if not already enabled
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
    `);

    // Create enum types (idempotent)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_role_enum" AS ENUM ('admin', 'manager', 'author', 'editor', 'reader');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "article_status_enum" AS ENUM ('draft', 'published', 'archived');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "import_job_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "export_job_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "resource_type_enum" AS ENUM ('users', 'articles', 'comments');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "export_format_enum" AS ENUM ('json', 'ndjson', 'csv');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create users table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" varchar(255) NOT NULL,
        "name" varchar(255) NOT NULL,
        "role" "user_role_enum" NOT NULL DEFAULT 'reader',
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email")
    `);

    // Create articles table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "articles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug" varchar(255) NOT NULL,
        "title" varchar(500) NOT NULL,
        "body" text NOT NULL,
        "author_id" uuid NOT NULL,
        "tags" jsonb NOT NULL DEFAULT '[]',
        "published_at" TIMESTAMP WITH TIME ZONE,
        "status" "article_status_enum" NOT NULL DEFAULT 'draft',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_articles_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_articles_slug" UNIQUE ("slug"),
        CONSTRAINT "FK_articles_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_articles_slug" ON "articles" ("slug")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_articles_author_id" ON "articles" ("author_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_articles_status" ON "articles" ("status")
    `);

    // Create comments table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "comments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "article_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "body" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_comments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_comments_article" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_comments_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comments_article_id" ON "comments" ("article_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comments_user_id" ON "comments" ("user_id")
    `);

    // Create import_jobs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "import_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "idempotency_key" varchar(255),
        "resource_type" "resource_type_enum" NOT NULL,
        "status" "import_job_status_enum" NOT NULL DEFAULT 'pending',
        "file_url" varchar(2048),
        "file_name" varchar(255),
        "file_size" bigint,
        "file_format" varchar(20),
        "total_rows" integer NOT NULL DEFAULT 0,
        "processed_rows" integer NOT NULL DEFAULT 0,
        "successful_rows" integer NOT NULL DEFAULT 0,
        "failed_rows" integer NOT NULL DEFAULT 0,
        "skipped_rows" integer NOT NULL DEFAULT 0,
        "errors" jsonb NOT NULL DEFAULT '[]',
        "metrics" jsonb,
        "error_message" text,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_import_jobs_id" PRIMARY KEY ("id")
      )
    `);

    // Add unique constraint for idempotency_key if it doesn't exist
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "import_jobs" ADD CONSTRAINT "UQ_import_jobs_idempotency_key" UNIQUE ("idempotency_key");
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_import_jobs_idempotency_key" ON "import_jobs" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_import_jobs_resource_type" ON "import_jobs" ("resource_type")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_import_jobs_status" ON "import_jobs" ("status")
    `);

    // Create export_jobs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "export_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "resource_type" "resource_type_enum" NOT NULL,
        "format" "export_format_enum" NOT NULL DEFAULT 'ndjson',
        "status" "export_job_status_enum" NOT NULL DEFAULT 'pending',
        "filters" jsonb,
        "fields" jsonb,
        "download_url" varchar(2048),
        "file_name" varchar(255),
        "file_size" bigint,
        "total_rows" integer NOT NULL DEFAULT 0,
        "exported_rows" integer NOT NULL DEFAULT 0,
        "metrics" jsonb,
        "error_message" text,
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_export_jobs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_export_jobs_resource_type" ON "export_jobs" ("resource_type")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_export_jobs_status" ON "export_jobs" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order due to foreign key constraints
    await queryRunner.query(`DROP TABLE IF EXISTS "export_jobs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "import_jobs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "comments" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "articles" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "export_format_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "resource_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "export_job_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "import_job_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "article_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}
