// EJS/Express deploys as source, not an SPA bundle. Validate the production
// entrypoint, every template and the files required by the Vercel function.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ejs from 'ejs';
const walk = (dir) => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const scripts=['server.js',...walk('src').filter(f=>f.endsWith('.js'))];
for(const file of scripts) execFileSync(process.execPath,['--check',file]);
const templates=walk('views').filter(f=>f.endsWith('.ejs'));
for(const file of templates) ejs.compile(fs.readFileSync(file,'utf8'),{filename:path.resolve(file)});
const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
if(!config.routes.some(r=>r.src==='/(.*)' && r.dest==='/server.js')) throw new Error('Missing frontend catch-all');
for(const pattern of ['views/**','public/**','src/**']) if(!config.builds[0].config.includeFiles.includes(pattern)) throw new Error(`Missing ${pattern}`);
const {default:handler}=await import('../server.js');
if(typeof handler!=='function') throw new Error('Missing Vercel handler');
console.log(`Production source build passed: ${scripts.length} JS modules, ${templates.length} EJS templates, Vercel entrypoint and packaging validated. No SPA bundle required.`);
