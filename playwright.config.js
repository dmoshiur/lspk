import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', testMatch:'**/*.spec.js', fullyParallel:false, workers:1,
  timeout:45000, reporter:'list', outputDir:'.tmp/browser-results',
  use:{baseURL:'http://localhost:4599', headless:true, viewport:{width:1440,height:1000},
    // Emulate Vercel's TLS terminator, while retaining production Secure cookies.
    extraHTTPHeaders:{'X-Forwarded-Proto':'https'},
    screenshot:'only-on-failure', trace:'retain-on-failure',
    launchOptions: process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE,
      args:['--no-sandbox','--no-zygote','--use-gl=angle','--use-angle=swiftshader']} : {},
  },
  webServer:[
    {command:'node e2e/fixture-api.mjs',port:4597,reuseExistingServer:false},
    {command:'node server.js',port:4599,reuseExistingServer:false,env:{PORT:'4599',NODE_ENV:'production',SESSION_SECRET:'browser-test-only-secret',BACKEND_URL:'http://127.0.0.1:4597'}},
  ],
});
