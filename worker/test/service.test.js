import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createService,eligible,locate,validURL,randomIndex} from '../src/index.js';
const root='https://raw.githubusercontent.com/test/research/commit/';
const env={MANIFEST_URL:root+'manifest.json'};
const digest=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function fixture({invalid=false,empty=false,fail=false,corrupt=false}={}) {
 const a='https://example.com/\n';const b=Array.from({length:9},(_,i)=>`https://site${i}.org/`).join('\n')+'\n';
 const groups={};const files=new Map();
 for(const [cat,data] of [['Small',invalid?'https://user:password@example.com/\n':a],['Large',b]]){
  const path=`urls/verified/${cat}/0000.txt`;
  groups[cat]={count:cat==='Small'?1:9,chunks:[{path,count:cat==='Small'?1:9,bytes:new TextEncoder().encode(data).length,sha256:await digest(data)}]};files.set(root+path,corrupt?data+'broken':data);
 }
 const manifest={pools:{verified:empty?{}:groups,all:{},commercial:{}}};let calls=0;
 const fetcher=async req=>{calls++;if(fail)return new Response('Unavailable',{status:500});return req.url===env.MANIFEST_URL?Response.json(manifest):new Response(files.get(req.url));};
 return {manifest,fetcher,get calls(){return calls;}};
}
test('URL validation rejects unsafe or malformed outputs',()=>{
 for(const u of ['https://example.com/','https://xn--e1afmkfd.xn--p1ai/'])assert.ok(validURL(u));
 for(const u of ['http://example.com/','https://u:p@example.com/','https://127.0.0.1/','https://localhost/','https://a.local/','https://a.org/?token=x','https://a.org/\nhttps://b.org/','javascript:alert(1)','https://a.org/path','https://[::1]/','https://a.org:99/'])assert.equal(validURL(u),false,u);
});
test('one domain has one vote; category size 1 versus 9',async()=>{
 const f=await fixture();const e=eligible(f.manifest,'verified','');assert.equal(e.total,10);let small=0;
 for(let i=0;i<100000;i++){if(locate(e.chunks,randomIndex(e.total)).chunk.path.includes('/Small/'))small++;}
 assert.ok(small>9500 && small<10500,`small=${small}`);console.log(`Distribution: small=${small}/100000 (expected 10%, tolerance 0.5 percentage point)`);
 for(let i=0;i<10;i++){const {chunk,offset}=locate(e.chunks,i);assert.ok(offset>=0 && offset<chunk.count);}
});
test('rejection sampling avoids modulo bias',()=>{
 let k=0;const random={getRandomValues(v){v[0]=k++===0?0xffffffff:8;}};assert.equal(randomIndex(10,random),8);assert.equal(k,2);
});
test('Cloudflare-compatible fetch rejects source redirects without following',async()=>{
 let calls=0;
 const h=createService({fetcher:async(req,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}});}});
 const r=await h(new Request('https://service/random'),env);
 assert.equal(r.status,503);assert.equal(calls,1);
});
test('success is exactly one HTTPS URL and a newline',async()=>{
 const f=await fixture();const h=createService({fetcher:f.fetcher});const r=await h(new Request('https://service/random?category=Small'),env);
 assert.equal(r.status,200);assert.equal(await r.text(),'https://example.com/\n');assert.match(r.headers.get('Content-Type'),/^text\/plain/);assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('category filter selects only requested group',async()=>{
 const f=await fixture();const h=createService({fetcher:f.fetcher});for(let i=0;i<30;i++){const r=await h(new Request('https://service/random?category=Large'),env);assert.match(await r.text(),/^https:\/\/site[0-8]\.org\/\n$/);}
});
test('empty and absent categories return 404',async()=>{
 const f=await fixture({empty:true});assert.equal((await createService({fetcher:f.fetcher})(new Request('https://service/random'),env)).status,404);
 const g=await fixture();assert.equal((await createService({fetcher:g.fetcher})(new Request('https://service/random?category=Absent'),env)).status,404);
});
test('source failure, corruption and invalid selected URL fail closed',async()=>{
 for(const option of [{fail:true},{corrupt:true},{invalid:true}]){const f=await fixture(option);const r=await createService({fetcher:f.fetcher})(new Request('https://service/random?category=Small'),env);assert.equal(r.status,503);assert.equal(await r.text(),'Dataset unavailable or invalid\n');}
});
test('invalid filters and methods rejected; arbitrary source prohibited',async()=>{
 const f=await fixture();const h=createService({fetcher:f.fetcher});
 for(const q of ['pool=invalid','category=../x','token=abc','pool=all&pool=verified'])assert.equal((await h(new Request('https://service/random?'+q),env)).status,400);
 assert.equal((await h(new Request('https://service/random',{method:'POST'}),env)).status,405);
 assert.equal((await h(new Request('https://service/random'),{MANIFEST_URL:'http://127.0.0.1/private'})).status,503);
});
test('cache stores source data, not selected responses',async()=>{
 const f=await fixture();const m=new Map();const cache={async match(k){return m.get(k.url)?.clone();},async put(k,v){m.set(k.url,v.clone());}};
 const h=createService({fetcher:f.fetcher,cache});for(let i=0;i<3;i++)assert.equal((await h(new Request('https://service/random?category=Small'),env)).status,200);
 assert.equal(f.calls,2);assert.equal(m.size,2);assert.equal(m.get(env.MANIFEST_URL).headers.get('Cache-Control'),'public,max-age=300');
});
test('real packaged manifest totals and chunk integrity',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../publish/manifest.json',import.meta.url),'utf8'));
 for(const pool of ['all','commercial','verified']){
  const e=eligible(manifest,pool,'');assert.ok(e.total>0);
  for(const chunk of e.chunks){const data=await readFile(new URL('../../publish/'+chunk.path,import.meta.url),'utf8');assert.equal(await digest(data),chunk.sha256);assert.equal(new TextEncoder().encode(data).length,chunk.bytes);const lines=data.trimEnd().split('\n');assert.equal(lines.length,chunk.count);assert.ok(lines.every(validURL));}
 }
});
