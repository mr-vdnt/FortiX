sed -i 's/url: process.env.DATABASE_URL,/url: process.env.DATABASE_URL, ssl: true/g' drizzle.config.ts
