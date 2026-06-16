require('reflect-metadata');
const { DataSource } = require('typeorm');
const { entities } = require('./entities');

const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities,
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
});

module.exports = { AppDataSource };
