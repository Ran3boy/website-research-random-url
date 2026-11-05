// Local-only adapter executes the identical Worker handler against packaged data.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createService} from './src/index.js';
const root=path.resolve(fileURLToPath(new URL('../publish/',import.meta.url)));
const prefix='https://raw.githubusercontent.com/local-fixture/data/immutable/';
const handle=createService({fetcher:async request=>{
 const url=typeof request==='string'?request:request.url;
 if(!url.startsWith(prefix))return new Response('Not found',{status:404});
 const p=path.resolve(root,url.slice(prefix.length));
 if(!p.startsWith(root+path.sep))return new Response('Forbidden',{status:403});
 try{return new Response(await readFile(p));}catch{return new Response('Not found',{status:404});}
}});
const server=http.createServer(async(req,res)=>{
 const result=await handle(new Request('http://127.0.0.1'+req.url,{method:req.method}),{MANIFEST_URL:prefix+'manifest.json',DEFAULT_POOL:'verified'});
 res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
});
server.listen(0,'127.0.0.1',()=>console.log(`LOCAL_ENDPOINT=http://127.0.0.1:${server.address().port}/random`));
