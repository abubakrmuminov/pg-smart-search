# pg-smart-search Integration Examples 📚

This directory contains practical integration patterns for using `pg-smart-search` with popular Node.js ORMs and frameworks.

### 🍱 Available Examples

1. **[Prisma Integration](prisma-example.ts)**: Demonstrates how to use the SDK alongside Prisma for high-performance search results while maintaining Prisma's strong typing for CRM/CRUD operations.
2. **[TypeORM Integration](typeorm-example.ts)**: Shows how to implement a custom `DatabaseAdapter` to leverage TypeORM's query runner and transactions.
3. **[Basic Usage](basic-usage.ts)**: Standard starting point for any Node.js application.

### 🚀 Running Examples

Most examples require a running PostgreSQL instance. We recommend using the provided test environment:

```bash
docker-compose -f docker-compose.test.yml up -d
# Then run an example via ts-node
ts-node examples/prisma-example.ts
```

### 💡 Integration Tips

- **Table Names**: Always ensure the `tableName` in the SDK config exactly matches the table name in your DB (Prisma usually uses PascalCase `User` while TypeORM might use `users`).
- **ID Columns**: If your primary key isn't named `id`, specify it in the `idColumn` config.
- **Transactions**: For data consistency during updates, you can wrap search logic inside ORM transactions using the custom adapter pattern shown in the TypeORM example.
