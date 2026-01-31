import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { User, Article, Comment, ImportJob, ExportJob } from './entities';

// Load environment variables
config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'bulk_import_export',
  entities: [User, Article, Comment, ImportJob, ExportJob],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: process.env.DATABASE_SYNCHRONIZE === 'true',
  logging: process.env.DATABASE_LOGGING === 'true',
  // Connection pool settings for production
  extra: {
    max: 20, // Maximum number of connections in the pool
    min: 5, // Minimum number of connections in the pool
    idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
    connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection not established
  },
  // SSL configuration - only enable if DATABASE_SSL is explicitly set to 'true'
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

// DataSource instance for TypeORM CLI and migrations
const AppDataSource = new DataSource(dataSourceOptions);

export default AppDataSource;
