const { execSync } = require('child_process');
try {
  execSync('pkill -f playwright');
} catch (e) {
  // Ignore
}
