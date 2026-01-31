import { DataType, newDb, IMemoryDb } from 'pg-mem';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  User,
  Article,
  Comment,
  ImportJob,
  ExportJob,
  UserRole,
  ArticleStatus,
  ImportJobStatus,
  ResourceType,
} from '../src/database/entities';

// Helper to create in-memory PostgreSQL database
function createMemoryDb(): IMemoryDb {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  });

  // Register PostgreSQL functions - must return new UUID each call
  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: DataType.uuid,
    implementation: () => uuidv4(),
    impure: true, // Important: mark as impure so it's called each time
  });

  db.public.registerFunction({
    name: 'current_database',
    returns: DataType.text,
    implementation: () => 'test_db',
  });

  db.public.registerFunction({
    name: 'version',
    returns: DataType.text,
    implementation: () => 'PostgreSQL 16.0 (pg-mem)',
  });

  return db;
}

describe('Integration Tests with In-Memory Database', () => {
  let dataSource: DataSource;
  let db: IMemoryDb;

  beforeAll(async () => {
    db = createMemoryDb();

    dataSource = await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [User, Article, Comment, ImportJob, ExportJob],
      synchronize: true,
      logging: false,
    });

    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    // Clean up tables before each test using raw SQL TRUNCATE CASCADE
    await dataSource.query('TRUNCATE TABLE "comments" CASCADE');
    await dataSource.query('TRUNCATE TABLE "articles" CASCADE');
    await dataSource.query('TRUNCATE TABLE "users" CASCADE');
    await dataSource.query('TRUNCATE TABLE "import_jobs" CASCADE');
    await dataSource.query('TRUNCATE TABLE "export_jobs" CASCADE');
  });

  describe('User Entity', () => {
    it('should create a user', async () => {
      const userRepo = dataSource.getRepository(User);

      const user = await userRepo.save({
        email: 'test@example.com',
        name: 'Test User',
        role: UserRole.ADMIN,
        active: true,
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('test@example.com');
      expect(user.role).toBe(UserRole.ADMIN);
    });

    it('should enforce unique email constraint', async () => {
      const userRepo = dataSource.getRepository(User);

      await userRepo.save({
        email: 'unique@example.com',
        name: 'User 1',
        role: UserRole.READER,
        active: true,
      });

      await expect(
        userRepo.save({
          email: 'unique@example.com',
          name: 'User 2',
          role: UserRole.EDITOR,
          active: true,
        }),
      ).rejects.toThrow();
    });

    it('should support all user roles', async () => {
      const userRepo = dataSource.getRepository(User);

      const roles = [
        UserRole.ADMIN,
        UserRole.MANAGER,
        UserRole.AUTHOR,
        UserRole.EDITOR,
        UserRole.READER,
      ];

      for (const role of roles) {
        const user = await userRepo.save({
          email: `${role}@example.com`,
          name: `${role} User`,
          role,
          active: true,
        });

        expect(user.role).toBe(role);
      }

      const users = await userRepo.find();
      expect(users).toHaveLength(5);
    });

    it('should update existing user', async () => {
      const userRepo = dataSource.getRepository(User);

      const user = await userRepo.save({
        email: 'update@example.com',
        name: 'Original Name',
        role: UserRole.READER,
        active: true,
      });

      user.name = 'Updated Name';
      (user as any).role = UserRole.ADMIN;
      await userRepo.save(user);

      const updated = await userRepo.findOne({ where: { id: user.id } });
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.role).toBe(UserRole.ADMIN);
    });
  });

  describe('Article Entity', () => {
    let author: User;

    beforeEach(async () => {
      author = await dataSource.getRepository(User).save({
        email: 'author@example.com',
        name: 'Article Author',
        role: UserRole.AUTHOR,
        active: true,
      });
    });

    it('should create an article', async () => {
      const articleRepo = dataSource.getRepository(Article);

      const article = await articleRepo.save({
        slug: 'test-article',
        title: 'Test Article',
        body: 'This is the article body',
        authorId: author.id,
        status: ArticleStatus.DRAFT,
        tags: ['test', 'article'],
      });

      expect(article.id).toBeDefined();
      expect(article.slug).toBe('test-article');
      expect(article.authorId).toBe(author.id);
    });

    it('should enforce unique slug constraint', async () => {
      const articleRepo = dataSource.getRepository(Article);

      await articleRepo.save({
        slug: 'unique-slug',
        title: 'Article 1',
        body: 'Body 1',
        authorId: author.id,
        status: ArticleStatus.DRAFT,
      });

      await expect(
        articleRepo.save({
          slug: 'unique-slug',
          title: 'Article 2',
          body: 'Body 2',
          authorId: author.id,
          status: ArticleStatus.DRAFT,
        }),
      ).rejects.toThrow();
    });

    it('should support all article statuses', async () => {
      const articleRepo = dataSource.getRepository(Article);

      const statuses = [ArticleStatus.DRAFT, ArticleStatus.PUBLISHED, ArticleStatus.ARCHIVED];

      for (let i = 0; i < statuses.length; i++) {
        const article = await articleRepo.save({
          slug: `article-${statuses[i]}`,
          title: `Article ${statuses[i]}`,
          body: 'Body',
          authorId: author.id,
          status: statuses[i],
        });

        expect(article.status).toBe(statuses[i]);
      }
    });

    it('should cascade delete articles when user is deleted', async () => {
      const articleRepo = dataSource.getRepository(Article);
      const userRepo = dataSource.getRepository(User);

      await articleRepo.save({
        slug: 'cascade-test',
        title: 'Cascade Test',
        body: 'Body',
        authorId: author.id,
        status: ArticleStatus.DRAFT,
      });

      // Delete the author
      await userRepo.delete({ id: author.id });

      // Article should be deleted too
      const articles = await articleRepo.find();
      expect(articles).toHaveLength(0);
    });
  });

  describe('Comment Entity', () => {
    let user: User;
    let article: Article;

    beforeEach(async () => {
      user = await dataSource.getRepository(User).save({
        email: 'commenter@example.com',
        name: 'Commenter',
        role: UserRole.READER,
        active: true,
      });

      const author = await dataSource.getRepository(User).save({
        email: 'articleauthor@example.com',
        name: 'Article Author',
        role: UserRole.AUTHOR,
        active: true,
      });

      article = await dataSource.getRepository(Article).save({
        slug: 'comment-test-article',
        title: 'Article for Comments',
        body: 'Body',
        authorId: author.id,
        status: ArticleStatus.PUBLISHED,
      });
    });

    it('should create a comment', async () => {
      const commentRepo = dataSource.getRepository(Comment);

      const comment = await commentRepo.save({
        articleId: article.id,
        userId: user.id,
        body: 'This is a test comment',
      });

      expect(comment.id).toBeDefined();
      expect(comment.articleId).toBe(article.id);
      expect(comment.userId).toBe(user.id);
    });

    it('should cascade delete comments when article is deleted', async () => {
      const commentRepo = dataSource.getRepository(Comment);
      const articleRepo = dataSource.getRepository(Article);

      await commentRepo.save({
        articleId: article.id,
        userId: user.id,
        body: 'Comment to be deleted',
      });

      await articleRepo.delete({ id: article.id });

      const comments = await commentRepo.find();
      expect(comments).toHaveLength(0);
    });

    it('should cascade delete comments when user is deleted', async () => {
      const commentRepo = dataSource.getRepository(Comment);
      const userRepo = dataSource.getRepository(User);

      await commentRepo.save({
        articleId: article.id,
        userId: user.id,
        body: 'Comment to be deleted',
      });

      await userRepo.delete({ id: user.id });

      const comments = await commentRepo.find();
      expect(comments).toHaveLength(0);
    });
  });

  describe('ImportJob Entity', () => {
    it('should create an import job', async () => {
      const importJobRepo = dataSource.getRepository(ImportJob);

      const job = await importJobRepo.save({
        resourceType: ResourceType.USERS,
        status: ImportJobStatus.PENDING,
        totalRows: 0,
        processedRows: 0,
        successfulRows: 0,
        failedRows: 0,
        skippedRows: 0,
        errors: [],
      });

      expect(job.id).toBeDefined();
      expect(job.status).toBe(ImportJobStatus.PENDING);
    });

    it('should update import job progress', async () => {
      const importJobRepo = dataSource.getRepository(ImportJob);

      const job = await importJobRepo.save({
        resourceType: ResourceType.USERS,
        status: ImportJobStatus.PENDING,
        totalRows: 100,
        processedRows: 0,
        successfulRows: 0,
        failedRows: 0,
        skippedRows: 0,
        errors: [],
      });

      (job as any).status = ImportJobStatus.PROCESSING;
      job.processedRows = 50;
      job.successfulRows = 48;
      job.failedRows = 2;
      await importJobRepo.save(job);

      const updated = await importJobRepo.findOne({ where: { id: job.id } });
      expect(updated?.status).toBe(ImportJobStatus.PROCESSING);
      expect(updated?.processedRows).toBe(50);
      expect(updated?.successfulRows).toBe(48);
      expect(updated?.failedRows).toBe(2);
    });

    it('should store errors as JSON', async () => {
      const importJobRepo = dataSource.getRepository(ImportJob);

      const errors = [
        { row: 1, field: 'email', message: 'Invalid email' },
        { row: 5, field: 'role', message: 'Invalid role' },
      ];

      const job = await importJobRepo.save({
        resourceType: ResourceType.USERS,
        status: ImportJobStatus.COMPLETED,
        totalRows: 10,
        processedRows: 10,
        successfulRows: 8,
        failedRows: 2,
        skippedRows: 0,
        errors,
      });

      const found = await importJobRepo.findOne({ where: { id: job.id } });
      expect(found?.errors).toEqual(errors);
    });

    it('should enforce unique idempotency key', async () => {
      const importJobRepo = dataSource.getRepository(ImportJob);

      await importJobRepo.save({
        resourceType: ResourceType.USERS,
        status: ImportJobStatus.PENDING,
        idempotencyKey: 'unique-key-123',
        totalRows: 0,
        processedRows: 0,
        successfulRows: 0,
        failedRows: 0,
        skippedRows: 0,
        errors: [],
      });

      await expect(
        importJobRepo.save({
          resourceType: ResourceType.ARTICLES,
          status: ImportJobStatus.PENDING,
          idempotencyKey: 'unique-key-123',
          totalRows: 0,
          processedRows: 0,
          successfulRows: 0,
          failedRows: 0,
          skippedRows: 0,
          errors: [],
        }),
      ).rejects.toThrow();
    });
  });

  describe('Upsert Logic Simulation', () => {
    it('should upsert users by email', async () => {
      const userRepo = dataSource.getRepository(User);

      // First insert
      await userRepo.save({
        email: 'upsert@example.com',
        name: 'Original Name',
        role: UserRole.READER,
        active: true,
      });

      // Simulate upsert - find by email and update
      let user = await userRepo.findOne({ where: { email: 'upsert@example.com' } });
      if (user) {
        user.name = 'Updated Name';
        user.role = UserRole.ADMIN;
        await userRepo.save(user);
      }

      // Verify
      user = await userRepo.findOne({ where: { email: 'upsert@example.com' } });
      expect(user?.name).toBe('Updated Name');
      expect(user?.role).toBe(UserRole.ADMIN);

      // Verify no duplicate
      const count = await userRepo.count();
      expect(count).toBe(1);
    });

    it('should upsert articles by slug', async () => {
      const userRepo = dataSource.getRepository(User);
      const articleRepo = dataSource.getRepository(Article);

      const author = await userRepo.save({
        email: 'articleauthor2@example.com',
        name: 'Author',
        role: UserRole.AUTHOR,
        active: true,
      });

      // First insert
      await articleRepo.save({
        slug: 'upsert-article',
        title: 'Original Title',
        body: 'Original Body',
        authorId: author.id,
        status: ArticleStatus.DRAFT,
      });

      // Simulate upsert - find by slug and update
      let article = await articleRepo.findOne({ where: { slug: 'upsert-article' } });
      if (article) {
        article.title = 'Updated Title';
        article.status = ArticleStatus.PUBLISHED;
        await articleRepo.save(article);
      }

      // Verify
      article = await articleRepo.findOne({ where: { slug: 'upsert-article' } });
      expect(article?.title).toBe('Updated Title');
      expect(article?.status).toBe(ArticleStatus.PUBLISHED);

      // Verify no duplicate
      const count = await articleRepo.count();
      expect(count).toBe(1);
    });
  });

  describe('Foreign Key Validation', () => {
    it('should reject article with non-existent author_id', async () => {
      const articleRepo = dataSource.getRepository(Article);
      const fakeAuthorId = uuidv4();

      await expect(
        articleRepo.save({
          slug: 'invalid-author-article',
          title: 'Test',
          body: 'Body',
          authorId: fakeAuthorId,
          status: ArticleStatus.DRAFT,
        }),
      ).rejects.toThrow();
    });

    it('should reject comment with non-existent article_id', async () => {
      const commentRepo = dataSource.getRepository(Comment);
      const userRepo = dataSource.getRepository(User);

      const user = await userRepo.save({
        email: 'commentuser@example.com',
        name: 'Comment User',
        role: UserRole.READER,
        active: true,
      });

      const fakeArticleId = uuidv4();

      await expect(
        commentRepo.save({
          articleId: fakeArticleId,
          userId: user.id,
          body: 'Test comment',
        }),
      ).rejects.toThrow();
    });

    it('should reject comment with non-existent user_id', async () => {
      const commentRepo = dataSource.getRepository(Comment);
      const userRepo = dataSource.getRepository(User);
      const articleRepo = dataSource.getRepository(Article);

      const author = await userRepo.save({
        email: 'author3@example.com',
        name: 'Author',
        role: UserRole.AUTHOR,
        active: true,
      });

      const article = await articleRepo.save({
        slug: 'fk-test-article',
        title: 'FK Test',
        body: 'Body',
        authorId: author.id,
        status: ArticleStatus.PUBLISHED,
      });

      const fakeUserId = uuidv4();

      await expect(
        commentRepo.save({
          articleId: article.id,
          userId: fakeUserId,
          body: 'Test comment',
        }),
      ).rejects.toThrow();
    });
  });

  describe('Duplicate Detection Within Batch', () => {
    it('should detect duplicate emails in a batch', async () => {
      const emails = [
        'user1@example.com',
        'user2@example.com',
        'user1@example.com', // duplicate
        'user3@example.com',
      ];

      const seenEmails = new Map<string, number>();
      const duplicates: { email: string; firstRow: number; duplicateRow: number }[] = [];

      emails.forEach((email, index) => {
        const row = index + 1;
        if (seenEmails.has(email)) {
          duplicates.push({
            email,
            firstRow: seenEmails.get(email)!,
            duplicateRow: row,
          });
        } else {
          seenEmails.set(email, row);
        }
      });

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].email).toBe('user1@example.com');
      expect(duplicates[0].firstRow).toBe(1);
      expect(duplicates[0].duplicateRow).toBe(3);
    });

    it('should detect duplicate slugs in a batch', async () => {
      const slugs = [
        'article-one',
        'article-two',
        'article-one', // duplicate
        'article-three',
        'article-two', // duplicate
      ];

      const seenSlugs = new Map<string, number>();
      const duplicates: { slug: string; firstRow: number; duplicateRow: number }[] = [];

      slugs.forEach((slug, index) => {
        const row = index + 1;
        if (seenSlugs.has(slug)) {
          duplicates.push({
            slug,
            firstRow: seenSlugs.get(slug)!,
            duplicateRow: row,
          });
        } else {
          seenSlugs.set(slug, row);
        }
      });

      expect(duplicates).toHaveLength(2);
    });
  });
});
