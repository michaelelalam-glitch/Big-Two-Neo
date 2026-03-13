const fs = require('fs');
if (!fs.existsSync('/tmp/jest-results.json')) { console.error('No file'); process.exit(1); }
const r = JSON.parse(fs.readFileSync('/tmp/jest-results.json', 'utf8'));
console.log('Suites:', r.numPassedTestSuites + '/' + r.numTotalTestSuites);
console.log('Tests:', r.numPassedTests + '/' + r.numTotalTests);
console.log('Success:', r.success);
if (!r.success) { console.error('FAILED:', r.numFailedTests, 'failures'); process.exit(1); }
console.log('All passed');
