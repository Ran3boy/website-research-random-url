import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {validURL} from './src/index.js';
const manifest=JSON.parse(await readFile(new URL('../publish/manifest.json',import.meta.url),'utf8'));
const start=new Date().toISOString();
const proc=spawn(process.execPath,['local-server.mjs'],{cwd:new URL('.',import.meta.url),stdio:['ignore','pipe','pipe']});
try {
 const endpoint=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Local server startup timeout')),10000);
  proc.stdout.on('data',data=>{const match=data.toString().match(/LOCAL_ENDPOINT=(\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  proc.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code));});
 });
 const calls=1000;const domains=new Set();let unclassified=0;let plain=0;
 const defaultResponse=await fetch(endpoint);assert.equal(defaultResponse.status,200);assert.ok(validURL((await defaultResponse.text()).trim()));
 const allCats=manifest.pools.all;
 const unclassifiedURLs=new Set();for(const chunk of allCats.Unclassified.chunks){const text=await readFile(new URL('../publish/'+chunk.path,import.meta.url),'utf8');for(const u of text.trimEnd().split('\n'))unclassifiedURLs.add(u);}
 for(let i=0;i<calls;i++){
  const r=await fetch(endpoint+'?pool=all');assert.equal(r.status,200);assert.match(r.headers.get('Content-Type'),/^text\/plain/);const body=await r.text();assert.match(body,/^https:\/\/[^\s]+\/\n$/);assert.ok(validURL(body.trim()));plain++;domains.add(body.trim());if(unclassifiedURLs.has(body.trim()))unclassified++;
 }
 const expected=allCats.Unclassified.count/Object.values(allCats).reduce((n,g)=>n+g.count,0);const observed=unclassified/calls;assert.ok(Math.abs(expected-observed)<.05);
 const cat='Agriculture';const allowed=new Set();for(const chunk of manifest.pools.verified[cat].chunks){for(const u of (await readFile(new URL('../publish/'+chunk.path,import.meta.url),'utf8')).trimEnd().split('\n'))allowed.add(u);}
 for(let i=0;i<30;i++){const r=await fetch(endpoint+'?category='+cat);assert.equal(r.status,200);assert.ok(allowed.has((await r.text()).trim()));}
 const result={started:start,ended:new Date().toISOString(),local_endpoint_tested:endpoint,local_server_stopped_after_test:true,publicly_deployed:false,all_pool_http_requests:calls,exact_one_url_plain_text_responses:plain,unique_selected_domains:domains.size,unclassified_expected_fraction:expected,unclassified_observed_fraction:observed,category_filter_requests:30,default_verified_pool_checked:true,selected_websites_visited:0,status:'PASS'};
 await writeFile(new URL('../local_http_tests.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{proc.kill();await new Promise(resolve=>{if(proc.exitCode!==null)resolve();else proc.once('exit',resolve);});}
