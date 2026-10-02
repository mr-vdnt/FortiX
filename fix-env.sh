find src -name "*.ts" -type f -exec sed -i 's/dotenv.config()/dotenv.config({ override: true })/g' {} +
sed -i 's/dotenv.config()/dotenv.config({ override: true })/g' server.ts
