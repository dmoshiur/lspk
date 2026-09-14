import { gunzipSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { offlineAssets } from './assets.js';
import { makeT } from '../src/i18n.js';
const api='http://127.0.0.1:4597';
const t=makeT('en');
async function control(request,path,data={}) {return request.post(`${api}/__test/${path}`,{data});}
async function login(page,role='user') {
  await page.goto('/login');
  await page.getByLabel(t('auth_email'),{exact:true}).fill(`${role}@example.test`);
  await page.getByLabel(t('auth_password'),{exact:true}).fill('test-only-password');
  await page.locator('form[action="/login"] button[type=submit]').click();
  await expect(page).toHaveURL(role==='user'?/\/dashboard$/:/\/admin$/);
}
async function menu(page){
  if(await page.locator('.navbar-toggler').isVisible()) {
    await page.locator('.navbar-toggler').click();
    await expect(page.locator('#navMain')).toHaveClass(/\bshow\b/);
  }
  await page.locator('#account-menu').click();
}
async function noOverflow(page){
  expect(await page.evaluate(()=>({doc:document.documentElement.scrollWidth,width:innerWidth}))).toEqual({doc:page.viewportSize().width,width:page.viewportSize().width});
}
test.beforeEach(async({request,context})=>{await control(request,'reset');await offlineAssets(context);});

test('anonymous direct URLs use login; unknown URLs retain custom 404',async({page})=>{
  for(const route of ['/dashboard','/profile','/profile/edit','/admin','/admin/dashboard','/shop/admin/orders','/messages/admin/messages']){
    await page.goto(route);await expect(page).toHaveURL(/\/login$/);await expect(page.locator('form[action="/login"]')).toBeVisible();
  }
  const r=await page.goto('/not-a-real-page');expect(r.status()).toBe(404);await expect(page.getByRole('heading',{name:t('err_404_title')})).toBeVisible();
});

test('production user login, secure cookies, navbar, direct access, reload, new tab and history',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await login(page);
  for(const name of ['connect.sid','bloodora.session']){
    const cookie=(await context.cookies()).find(c=>c.name===name);expect(cookie?.secure).toBe(true);expect(cookie?.httpOnly).toBe(true);
  }
  await expect(page.locator('nav a[href="/login"]')).toHaveCount(0);await expect(page.locator('nav a[href="/register"]')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:t('dash_welcome',{name:'Browser'})})).toBeVisible();
  await expect(page.getByText(t('dash_no_orders'),{exact:false})).toBeVisible();
  await expect(page.getByText(t('dash_no_donation'),{exact:true})).toBeVisible();
  await menu(page);await expect(page.locator('#navMain a[href="/admin"]')).toHaveCount(0);
  await page.locator('#navMain a[href="/profile"]').click();
  await expect(page).toHaveURL(/\/profile$/);await expect(page.getByText('user@example.test',{exact:false}).first()).toBeVisible();
  expect((await page.reload()).status()).toBe(200);
  await page.goto('/profile/edit');await page.goBack();await expect(page).toHaveURL(/\/profile$/);await page.goForward();await expect(page).toHaveURL(/\/profile\/edit$/);
  const tab=await context.newPage();expect((await tab.goto('/dashboard')).status()).toBe(200);await tab.close();
  await page.goto('/dashboard');await page.screenshot({path:'.tmp/verified-dashboard-desktop.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('profile edit forwards PUT fields, refresh reads API state; validation and missing endpoint never claim success',async({page,request})=>{
  await login(page);await page.goto('/profile');await page.getByRole('link',{name:t('prof_edit'),exact:false}).click();
  await page.getByLabel(t('auth_full_name'),{exact:true}).fill('Updated contract name');
  await page.getByLabel(t('common_phone'),{exact:true}).fill('01800000000');
  await page.getByLabel(t('auth_holding'),{exact:true}).fill('Updated address');
  await page.getByRole('button',{name:t('common_save'),exact:true}).click();
  await expect(page).toHaveURL(/\/profile$/);await expect(page.getByText(t('prof_saved'),{exact:false})).toBeVisible();
  await page.reload();await expect(page.getByText('Updated contract name',{exact:true})).toBeVisible();await expect(page.getByText('Updated address',{exact:false})).toBeVisible();
  const calls=await (await request.get(`${api}/__test/calls`)).json();
  expect(calls.some(c=>c.method==='PUT'&&c.path==='/api/users/me'&&c.authorization.startsWith('Bearer contract-'))).toBe(true);
  expect(calls.find(c=>c.method==='PROFILE_FIELDS')).toMatchObject({name:'Updated contract name',phone:'01800000000',holding:'Updated address'});
  await page.goto('/profile/edit');await page.getByLabel(t('common_phone'),{exact:true}).fill('invalid');await page.getByRole('button',{name:t('common_save'),exact:true}).click();
  await expect(page.locator('[role=alert]')).toContainText('Invalid phone number');await expect(page.locator('[name=phone]')).toHaveValue('invalid');
  await control(request,'failure',{path:'/api/users/me',status:404});await page.locator('[name=phone]').fill('01900000000');await page.getByRole('button',{name:t('common_save'),exact:true}).click();
  await expect(page.locator('[role=alert]')).toContainText('PUT /api/users/me');await expect(page.locator('[role=alert]')).not.toContainText(t('prof_saved'));
  await page.goto('/profile');await expect(page.getByText('01800000000',{exact:false})).toBeVisible();
});

test('normal users are denied every admin namespace, including POSTs',async({page,request})=>{
  await login(page);
  for(const route of ['/admin','/admin/dashboard','/admin/users','/admin/settings','/shop/admin/products','/messages/admin/messages','/support/admin/sessions','/ai-help/admin/config']){
    expect((await page.goto(route)).status(),route).toBe(403);
    await expect(page.getByRole('heading',{name:t('err_403_title')})).toBeVisible();
  }
  const r=await page.request.post('/admin/create-admin',{form:{name:'must not reach API'}});expect(r.status()).toBe(403);
  const calls=await (await request.get(`${api}/__test/calls`)).json();expect(calls.some(c=>c.path==='/api/admin/create-admin')).toBe(false);
});

for(const role of ['admin','superadmin']) test(`${role}: real route handlers render all connected admin sections`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await login(page,role);await expect(page.getByRole('heading',{name:t('adm_dashboard'),exact:false})).toBeVisible();
  await page.goto('/admin/dashboard');await expect(page).toHaveURL(/\/admin$/);expect((await page.reload()).status()).toBe(200);
  await page.screenshot({path:`.tmp/verified-${role}-desktop.png`,fullPage:true});
  const tab=await page.context().newPage();expect((await tab.goto('/admin')).status()).toBe(200);await tab.close();
  const links=await page.locator('aside nav a').evaluateAll(els=>els.map(e=>e.getAttribute('href')));
  for(const route of links){expect((await page.goto(route)).status(),route).toBe(200);expect(page.url()).not.toMatch(/\/login$/);await expect(page.getByRole('heading',{name:t('err_404_title')})).toHaveCount(0);}
  expect(errors).toEqual([]);
});

test('admin failure stays on /admin with unavailable values and retry, revoked roles are rechecked immediately',async({page,request})=>{
  await login(page,'admin');await control(request,'failure',{path:'/api/admin/dashboard',status:503});
  expect((await page.goto('/admin')).status()).toBe(200);await expect(page).toHaveURL(/\/admin$/);await expect(page.locator('[role=alert]')).toContainText(t('common_load_failed'));
  await expect(page.locator('form[action="/admin/notice"]')).toHaveCount(0);await expect(page.locator('.stat-card').first()).toContainText('—');
  await control(request,'failure',{path:'/api/admin/dashboard',status:0});await control(request,'demote');expect((await page.goto('/admin')).status()).toBe(403);
});

test('dashboard section failure is explicit; /me outage is not a fake logout and revoked token returns login',async({page,request})=>{
  await login(page);await control(request,'failure',{path:'/api/shop/orders/mine',status:503});await page.goto('/dashboard');
  await expect(page.getByText(t('common_load_failed'),{exact:false}).first()).toBeVisible();await expect(page.getByText(t('dash_no_orders'),{exact:false})).toHaveCount(0);
  await control(request,'failure',{path:'/api/auth/me',status:503});expect((await page.goto('/profile')).status()).toBe(503);
  await control(request,'failure',{path:'/api/auth/me',status:0});expect((await page.goto('/profile')).status()).toBe(200);
  await control(request,'failure',{path:'/api/auth/me',status:401});await page.goto('/dashboard');await expect(page).toHaveURL(/\/login$/);
});

test('logout clears both cookies, navbar and private history access; Bengali persists',async({page,context})=>{
  await login(page);await page.goto('/set-language/bn?next=/dashboard');await page.locator('.dash-sidebar form[action="/logout"] button').click();await expect(page).toHaveURL('http://localhost:4599/');
  // The public page may create a new language/cart session, but never retain auth.
  const cookie=(await context.cookies()).find(c=>c.name==='bloodora.session');
  const session=cookie ? JSON.parse(gunzipSync(Buffer.from(decodeURIComponent(cookie.value).split('.')[0],'base64url')).toString()) : {};
  expect(session.token).toBeUndefined();expect(session.userCache).toBeUndefined();
  await page.goBack();await expect(page).toHaveURL(/\/login$/);
  await page.goto('/profile');await expect(page).toHaveURL(/\/login$/);await expect(page.locator('html')).toHaveAttribute('lang','bn');await expect(page.locator('#account-menu')).toHaveCount(0);
});

test('login return URL cannot send users to missing pages or admin routes',async({page})=>{
  await page.goto('/login?next=/nonexistent');await page.locator('[name=email]').fill('user@example.test');await page.locator('[name=password]').fill('test-only-password');await page.locator('form[action="/login"] button').click();await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/login');await expect(page).toHaveURL(/\/dashboard$/);await page.goto('/register');await expect(page).toHaveURL(/\/dashboard$/);
});

test('Bengali/English account pages remain usable on mobile, tablet, laptop and desktop',async({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await login(page,'admin');
  for(const lang of ['bn','en']){
    const tr=makeT(lang);
    for(const width of [375,768,1024,1440]){
      await page.setViewportSize({width,height:900});
      for(const [route,key] of [['/dashboard','dash_welcome'],['/profile','prof_title'],['/profile/edit','prof_edit'],['/admin','adm_dashboard']]){
        expect((await page.goto(`/set-language/${lang}?next=${route}`)).status()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('lang',lang);
        await expect(page.getByRole('heading',{name:tr(key,{name:'Browser'}),exact:false})).toBeVisible();
        await noOverflow(page);
        if(width===375) await page.screenshot({path:`.tmp/verified-${lang}-${route.replaceAll('/','-')}-mobile.png`,fullPage:true});
      }
      await menu(page);await expect(page.locator('#navMain a[href="/profile"]')).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});


test('API timeout is bounded and malformed successes stay unavailable',async({page,request})=>{
  await login(page);await control(request,'failure',{path:'/api/shop/orders/mine',status:-1});
  const started=Date.now();expect((await page.goto('/dashboard')).status()).toBe(200);expect(Date.now()-started).toBeLessThan(12000);
  await expect(page.getByText(t('common_load_failed'),{exact:false}).first()).toBeVisible();
  await control(request,'failure',{path:'/api/users/me',status:-2});await page.goto('/profile/edit');
  await page.getByLabel(t('auth_full_name'),{exact:true}).fill('Must not save');await page.getByRole('button',{name:t('common_save'),exact:true}).click();
  await expect(page.locator('[role=alert]')).toContainText(t('prof_save_unconfirmed'));await expect(page.locator('[role=alert]')).not.toContainText(t('prof_saved'));
  await page.goto('/profile');await expect(page.getByText('Browser user',{exact:true})).toBeVisible();
});


test('registration uses existing API and lands in the registered user dashboard',async({page,request})=>{
  await page.goto('/register');
  for(const [name,value] of Object.entries({name:'Registered contract user',phone:'01700000000',email:'registered@example.test',password:'test-only-password',date_of_birth:'2000-01-01'})) await page.locator(`[name="${name}"]`).fill(value);
  await page.locator('[name=blood_group]').selectOption('O+');await page.locator('[name=role]').selectOption('Both');
  await page.locator('[name=division]').selectOption({index:1});await page.locator('[name=district]').selectOption({index:1});await page.locator('[name=upazila]').selectOption({index:1});
  await page.locator('form[action="/register"] button[type=submit]').click();await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/profile');await expect(page.getByText('registered@example.test',{exact:false})).toBeVisible();
  expect((await (await request.get(`${api}/__test/calls`)).json()).some(c=>c.method==='POST'&&c.path==='/api/auth/register')).toBe(true);
});
