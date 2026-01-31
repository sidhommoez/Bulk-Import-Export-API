import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDistributedLockingColumns1738336800000 implements MigrationInterface {
  name = 'AddDistributedLockingColumns1738336800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add columns to import_jobs table
    await queryRunner.query(`
      ALTER TABLE "import_jobs"
      ADD COLUMN "version" integer NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      ALTER TABLE "import_jobs"
      ADD COLUMN "locked_by" varchar(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "import_jobs"
      ADD COLUMN "locked_at" timestamptz NULL
    `);

    // Add index for locked_by on import_jobs
    await queryRunner.query(`
      CREATE INDEX "idx_import_jobs_locked_by" ON "import_jobs" ("locked_by")
    `);

    // Add columns to export_jobs table
    await queryRunner.query(`
      ALTER TABLE "export_jobs"
      ADD COLUMN "version" integer NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      ALTER TABLE "export_jobs"
      ADD COLUMN "locked_by" varchar(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "export_jobs"
      ADD COLUMN "locked_at" timestamptz NULL
    `);

    // Add index for locked_by on export_jobs
    await queryRunner.query(`
      CREATE INDEX "idx_export_jobs_locked_by" ON "export_jobs" ("locked_by")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove index and columns from export_jobs
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_export_jobs_locked_by"
    `);

    await queryRunner.query(`
      ALTER TABLE "export_jobs"
      DROP COLUMN IF EXISTS "locked_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "export_jobs"
      DROP COLUMN IF EXISTS "locked_by"
    `);

    await queryRunner.query(`
      ALTER TABLE "export_jobs"
      DROP COLUMN IF EXISTS "version"
    `);

    // Remove index and columns from import_jobs
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_import_jobs_locked_by"
    `);

    await queryRunner.query(`
      ALTER TABLE "import_jobs"
      DROP COLUMN IF EXISTS "locked_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "import_jobs"
      DROP COLUMN IF EXISTS "locked_by"
    `);

    await queryRunner.query(`
      ALTER TABLE "import_jobs"
      DROP COLUMN IF EXISTS "version"
    `);
  }
}
