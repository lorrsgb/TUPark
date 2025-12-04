// 1. Change 'https' to 'http'
const http = require('http');

console.log("Starting DoS Attack simulation (HTTP)...");

let successCount = 0;
let failCount = 0;

// Send 100 requests as fast as possible
for (let i = 0; i < 100; i++) {
    // 2. Use http.get and ensure the URL starts with http://
    http.get('http://localhost:3000', (res) => {
        if (res.statusCode === 200) {
            successCount++;
            console.log(`Request ${i}: Success (200)`);
        } else if (res.statusCode === 429) {
            failCount++;
            console.log(`Request ${i}: BLOCKED by Rate Limit (429)`);
        }
    }).on('error', (e) => {
        console.error(`Request ${i}: Error - ${e.message}`);
    });
}