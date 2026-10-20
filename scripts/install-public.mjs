import {mkdir,readFile,copyFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const vault=process.argv[2];
if(!vault)throw new Error('Usage: npm run install:vault -- /absolute/path/to/vault');
const config=join(resolve(vault),'.obsidian');await access(config);
const dest=join(config,'plugins','lingua-atelier');await mkdir(dest,{recursive:true});
const stamp=Date.now();
for(const name of ['main.js','manifest.json','styles.css']){
  const target=join(dest,name);
  try{await access(target);await copyFile(target,`${target}.backup-${stamp}`);}catch(e){if(e.code!=='ENOENT')throw e;}
  await copyFile(join('dist','lingua-atelier',name),target);
}
console.log('Installed three plugin files. Existing data and other plugins preserved. Enable Lingua Atelier in Obsidian after restarting.');
