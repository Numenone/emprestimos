const { execSync } = require('child_process')

try {
  execSync('npx prisma generate', { stdio: 'inherit' })
  execSync('npx prisma migrate deploy', { stdio: 'inherit' })
} catch (error) {
  process.exit(1)
}