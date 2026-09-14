import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountHome, isAdmin, normalizeUser, requireAdmin } from '../src/middleware/auth.js';
import { apiGet, ApiError, proxyEventStream } from '../src/api.js';
import { makeT } from '../src/i18n.js';
import { readFileSync } from 'node:fs';

test('only explicit server-issued admin flags grant admin access',()=>{
  for(const value of [true,1,'1']) assert.equal(isAdmin({is_admin:value}),true);
  for(const value of [false,0,'0','false',null,undefined,'admin']) assert.equal(isAdmin({is_admin:value}),false);
  assert.equal(accountHome({is_admin:0,is_super_admin:1}),'/admin');
  assert.equal(accountHome({is_admin:'0',is_super_admin:'0',role:'Donor'}),'/dashboard');
  assert.equal(isAdmin({role:'superadmin'}),false);
});

test('malformed account payloads never establish authenticated state',()=>{
  for(const value of [null,{}, {id:1}]) assert.throws(()=>normalizeUser(value),ApiError);
  const u=normalizeUser({id:'abc',name:'Normal',is_admin:'0',is_super_admin:'0',can_donate:'0'});
  assert.equal(u.is_admin,false);assert.equal(u.can_donate,false);
});

test('role guard renders 403 for normal users and login for anonymous visitors',()=>{
  const t=makeT('bn');let status,view,redirect,called=false;
  const res={status(s){status=s;return this;},render(v){view=v;},redirect(v){redirect=v;}};
  requireAdmin({t,session:{},user:{is_admin:0},originalUrl:'/admin'},res,()=>{called=true;});
  assert.equal(status,403);assert.equal(view,'403');assert.equal(called,false);
  requireAdmin({t,session:{},originalUrl:'/admin'},res,()=>{called=true;});
  assert.equal(redirect,'/login');assert.equal(called,false);
});

test('API client rejects ok:false even with HTTP 200 and supplies a deadline',async()=>{
  const original=global.fetch;
  try{
    global.fetch=async(url,init)=>{assert.ok(init.signal instanceof AbortSignal);return new Response(JSON.stringify({ok:false,message:'Not saved'}),{status:200});};
    await assert.rejects(apiGet('/api/users/me','test-only-token'),/Not saved/);
  }finally{global.fetch=original;}
});

test('admin SSE proxy forwards its bearer token, never an anonymous request',async()=>{
  const original=global.fetch;let authorization,status;
  try{
    global.fetch=async(url,init)=>{authorization=init.headers.Authorization;return new Response(null,{status:403});};
    await proxyEventStream({session:{token:'test-only-token'}},{status(s){status=s;return this;},end(){}},'/api/support/admin/stream');
    assert.equal(authorization,'Bearer test-only-token');assert.equal(status,403);
  }finally{global.fetch=original;}
});

test('canonical profile routes are registered before the custom 404 fallback',()=>{
  const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  for(const route of ['/profile','/dashboard','/admin']) assert.ok(server.indexOf(`app.use("${route}"`)<server.indexOf('renderError(req, res, 404'));
  assert.match(server,/app\.set\("trust proxy", 1\)/);
});

test('multipart response persistence re-enters the correct request context',async()=>{
  const { CookieSessionStore, sessionResponseContext }=await import('../src/middleware/cookieStore.js');
  const store=new CookieSessionStore({secret:'multipart-test-secret'});
  function response(token){
    const headers={};
    const res={headersSent:false,getHeader(k){return headers[k];},setHeader(k,v){headers[k]=v;},
      end(){store.set('sid',{token,cookie:{maxAge:60000}},err=>assert.ifError(err));},write(){},writeHead(){}};
    sessionResponseContext({headers:{}},res,()=>{});
    return {res,headers};
  }
  // End in reverse order, outside the original middleware context. Cookies
  // must belong to their own responses, not whichever request ran most recently.
  const a=response('first'),b=response('second');b.res.end();a.res.end();
  assert.ok(a.headers['Set-Cookie'][0].startsWith('bloodora.session='));
  assert.ok(b.headers['Set-Cookie'][0].startsWith('bloodora.session='));
  assert.notEqual(a.headers['Set-Cookie'][0],b.headers['Set-Cookie'][0]);
});
