import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'insecure-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'poojagnam',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  },
};

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  BASE_COMMANDER: 'base_commander',
  LOGISTICS_OFFICER: 'logistics_officer',
});