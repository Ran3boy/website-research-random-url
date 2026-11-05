const MAX_MANIFEST = 2 * 1024 * 1024;
const MAX_CHUNK = 2 * 1024 * 1024;
const POOLS = new Set(['verified', 'all', 'commercial']);

export function randomIndex(n, random = crypto) {
  if (!Number.isSafeInteger(n) || n < 1 || n > 0x100000000) throw new Error('Invalid population');
  const limit = Math.floor(0x100000000 / n) * n;
  const value = new Uint32Array(1);
  do { random.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % n;
}
export function validURL(line) {
  if (typeof line !== 'string' || line.length > 300 || /[\s\\]/.test(line)) return false;
  try {
    const u = new URL(line);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      !u.search && !u.hash && u.pathname === '/' &&
      !/^[\d.]+$/.test(u.hostname) && !u.hostname.includes(':') &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(u.hostname) &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(u.hostname);
  } catch { return false; }
}
export function eligible(manifest, pool, category) {
  const cats = manifest.pools?.[pool];
  if (!cats || typeof cats !== 'object') throw new Error('Bad manifest pool');
  const selected = category ? (Object.hasOwn(cats, category) ? [[category,cats[category]]] : []) : Object.entries(cats);
  const chunks = []; let total = 0;
  for (const [name, group] of selected) {
    if (!Array.isArray(group.chunks)) throw new Error('Bad category');
    let categoryTotal = 0;
    for (const chunk of group.chunks) {
      if (!Number.isSafeInteger(chunk.count) || chunk.count <= 0 || chunk.count > 10000 ||
          !/^urls\/(?:all|verified|commercial)\/[A-Za-z0-9_]+\/\d{4,}\.txt$/.test(chunk.path) ||
          !chunk.path.startsWith(`urls/${pool}/${name}/`) ||
          !/^[a-f0-9]{64}$/.test(chunk.sha256) || chunk.bytes > MAX_CHUNK) throw new Error('Bad chunk');
      total += chunk.count; categoryTotal += chunk.count; chunks.push({...chunk, end: total});
    }
    if (categoryTotal !== group.count) throw new Error('Category count mismatch');
  }
  if (total > 0x100000000) throw new Error('Population too large');
  return {chunks, total};
}
export function locate(chunks, index) {
  let lo=0, hi=chunks.length-1;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(index<chunks[mid].end)hi=mid;else lo=mid+1; }
  const chunk=chunks[lo]; if(!chunk || index>=chunk.end || index<0)throw new Error('Index outside population');
  return {chunk, offset:index-(chunk.end-chunk.count)};
}
function sourceURL(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash ||
      !['raw.githubusercontent.com','gist.githubusercontent.com'].includes(u.hostname)) throw new Error('GitHub raw source required');
  return u;
}
async function limitedText(response, max) {
  if (!response.ok) throw new Error('Source unavailable');
  if (Number(response.headers.get('content-length')) > max) throw new Error('Source too large');
  const reader=response.body.getReader(); const parts=[]; let size=0;
  try { while(true) { const {done,value}=await reader.read(); if(done)break;size+=value.length;if(size>max)throw new Error('Source too large');parts.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  const data=new Uint8Array(size);let at=0;for(const p of parts){data.set(p,at);at+=p.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(data);
}
export function createService({fetcher=fetch, cache=globalThis.caches?.default, random=crypto}={}) {
  async function load(url,max,ttl) {
    const key=new Request(url); let response=cache ? await cache.match(key) : undefined;
    if (response) return limitedText(response,max);
    response=await fetcher(key,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'text/plain,application/json'}});
    const text=await limitedText(response,max);
    if(cache)await cache.put(key,new Response(text,{headers:{'Cache-Control':`public,max-age=${ttl}`}}));
    return text;
  }
  return async function handle(request,env) {
    if(request.method!=='GET')return new Response('GET required\n',{status:405,headers:{Allow:'GET'}});
    const url=new URL(request.url);
    if(url.pathname!=='/' && url.pathname!=='/random')return new Response('Not found\n',{status:404});
    if([...url.searchParams.keys()].some(k=>!['pool','category'].includes(k)) ||
       ['pool','category'].some(k=>url.searchParams.getAll(k).length>1))return new Response('Invalid filter\n',{status:400});
    const pool=url.searchParams.get('pool') || env.DEFAULT_POOL || 'verified';
    const category=url.searchParams.get('category') ?? env.DEFAULT_CATEGORY ?? '';
    if(!POOLS.has(pool) || (category && !/^[A-Za-z0-9_]{1,80}$/.test(category)))return new Response('Invalid filter\n',{status:400});
    try {
      const manifestURL=sourceURL(env.MANIFEST_URL);
      const manifest=JSON.parse(await load(manifestURL.href,MAX_MANIFEST,300));
      const {chunks,total}=eligible(manifest,pool,category);
      if(!total)return new Response('No entries for filter\n',{status:404});
      const {chunk,offset}=locate(chunks,randomIndex(total,random));
      const chunkURL=new URL(chunk.path,manifestURL);
      if(!chunkURL.href.startsWith(new URL('./',manifestURL).href))throw new Error('Source path escaped');
      const text=await load(chunkURL.href,MAX_CHUNK,86400);
      const bytes=new TextEncoder().encode(text);
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(digest!==chunk.sha256 || bytes.length!==chunk.bytes)throw new Error('Chunk integrity failed');
      const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();
      if(lines.length!==chunk.count || !validURL(lines[offset]))throw new Error('Invalid selected URL');
      return new Response(lines[offset]+'\n',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    } catch {
      // No raw upstream URLs, response bodies or credentials enter responses/logs.
      return new Response('Dataset unavailable or invalid\n',{status:503,headers:{'Cache-Control':'no-store'}});
    }
  };
}
export default {fetch:(request,env)=>createService()(request,env)};
