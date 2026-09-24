import { execSync } from 'child_process';

const args = process.argv.slice(2);
const isLiveOnly = args.includes('--live-only') || args.includes('--live_only');
const isLive = args.includes('--live') || isLiveOnly;

try {
  if (!isLiveOnly) {
    console.log('--- Running Moodle Client Tests ---');
    execSync('pnpm test:moodle-client', { stdio: 'inherit' });
    
    console.log('\n--- Running Build Parity Tests ---');
    execSync('pnpm test:parity', { stdio: 'inherit' });
    
    console.log('\n--- Running E2E Tests ---');
    execSync('pnpm test:e2e', { stdio: 'inherit' });
  } else {
    console.log('--- Skipping standard automated tests (--live-only provided) ---');
  }
  
  if (isLive) {
    console.log('\n--- Running Live Moodle API Tests ---');
    execSync('node --env-file=moodle_test_credentials.env scripts/test-moodle-live.mjs', { stdio: 'inherit' });
  } else {
    console.log('\n(Skipped Live Moodle API tests. Run with "pnpm test -- --live" to include them)');
  }
} catch (error) {
  console.error('\nTest suite failed!');
  process.exit(1);
}
