import {
  createPostgresPool,
  migratePostgres,
  postgresConfigFromEnvironment,
  seedApprovedRegistry,
  validateProductSchema,
} from './index.js';

const command = process.argv[2];
if (!command || !['migrate', 'seed', 'verify'].includes(command)) {
  throw new Error('Usage: cli.js migrate|seed|verify');
}

const pool = createPostgresPool(postgresConfigFromEnvironment());
try {
  if (command === 'migrate') {
    const applied = await migratePostgres(pool, { applicationBuild: process.env['MALIGN_APPLICATION_BUILD'] ?? 'local' });
    console.log(`Migrations applied: ${applied.length}`);
  } else if (command === 'seed') {
    const result = await seedApprovedRegistry(pool);
    console.log(
      `Registry seeded: ${result.definitions} definitions, ${result.templates} templates, ${result.effects} effects`,
    );
  } else {
    await validateProductSchema(pool);
    console.log('Product schema manifest: 87/87');
  }
} finally {
  await pool.end();
}
