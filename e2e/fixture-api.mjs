// TEST ONLY. Contract fixtures, not a backend implementation or demo data.
// Never imported by server.js; only Playwright starts this loopback server.
import express from 'express';
import multer from 'multer';
const app = express();
app.use(express.json());
let users, tokens, calls, failures;
function reset() {
  users = Object.fromEntries(['user','admin','superadmin'].map((role,i)=>[role, {
    id:i+1, name:`Browser ${role}`, email:`${role}@example.test`, phone:'01700000000',
    blood_group:'O+', role:role==='superadmin'?'super_admin':role, donation_role:'Both', is_admin:role==='admin' ? 1 : 0,
    is_super_admin:role==='superadmin' ? 1 : 0, is_verified:1, can_donate:1,
    age:25, district:'Rajshahi', upazila:'Shibganj', image_file:'default.jpg',
    address_holding:'Test address', last_donation:null, created_at:'2025-01-01',
  }]));
  tokens = new Map(); calls = []; failures = {};
}
reset();
app.post('/__test/reset', (req,res)=>{reset(); res.json({ok:true});});
app.post('/__test/failure', (req,res)=>{failures[req.body.path]=req.body.status;res.json({ok:true});});
app.post('/__test/demote', (req,res)=>{users.admin.is_admin=0;res.json({ok:true});});
app.get('/__test/calls',(req,res)=>res.json(calls));
app.use((req,res,next)=>{
  calls.push({method:req.method,path:req.path,authorization:req.get('Authorization')});
  const status=failures[req.path];
  if(status===-1) {req.on('close',()=>res.end());return;} // explicit timeout fixture
  if(status===-2) return res.json({ok:true}); // malformed success fixture
  if(status) return res.status(status).json({ok:false,success:false,message:'Test API unavailable'});
  next();
});
app.get('/api/meta/settings',(req,res)=>res.json({settings:{logo_file:'/images/logo.png',favicon_file:'/favicon.png',site_tagline:'',ai_enabled:false,live_chat_enabled:false,live_activity_enabled:false}}));
app.get('/api/meta/home',(req,res)=>res.json({settings:{},notice:null,total_donors:0,urgent_requests:0,recent_donors:[],recent_requests:[]}));
app.get('/api/meta/locations',(req,res)=>res.json({bangladeshData:{}}));
app.post('/api/auth/login',(req,res)=>{
  const role=req.body.email?.split('@')[0], user=users[role];
  if(!user || req.body.password!=='test-only-password') return res.status(401).json({success:false,message:'Invalid test login'});
  const token=`contract-${role}-${Date.now()}`; tokens.set(token,role);res.json({success:true,user,token});
});
app.post('/api/auth/register',multer().none(),(req,res)=>{
  users.user={...users.user,name:req.body.name,email:req.body.email};
  const token=`contract-register-${Date.now()}`;tokens.set(token,'user');res.json({success:true,token,user:users.user});
});
app.use((req,res,next)=>{
  const role=tokens.get(req.get('Authorization')?.replace('Bearer ',''));
  if(!role) return res.status(401).json({success:false,message:'Login required'});
  req.user=users[role]; next();
});
app.get('/api/auth/me',(req,res)=>res.json({user:req.user}));
app.post('/api/auth/logout',(req,res)=>{tokens.delete(req.get('Authorization').replace('Bearer ',''));res.json({ok:true});});
app.put('/api/users/me',multer().single('profile_pic'),(req,res)=>{
  if(req.body.phone==='invalid') return res.status(400).json({success:false,message:'Invalid phone number'});
  Object.assign(req.user,{name:req.body.name,phone:req.body.phone,address_holding:req.body.holding,birth_certificate_number:req.body.birth_certificate,date_of_birth:req.body.date_of_birth});
  calls.push({method:'PROFILE_FIELDS',...req.body});
  res.json({success:true,user:req.user});
});
app.get('/api/shop/orders/mine',(req,res)=>res.json({orders:[]}));
app.get('/api/blood-requests/mine',(req,res)=>res.json({requests:[]}));
app.get('/api/messages',(req,res)=>res.json({received:[],sent:[],unread_count:0}));
app.get('/api/reviews/mine',(req,res)=>res.json({reviews:[]}));
app.get('/api/blood-requests',(req,res)=>res.json({requests:[]}));
app.get('/api/donors',(req,res)=>res.json({users:[]}));
app.use((req,res,next)=>{
  if(!req.user.is_admin && !req.user.is_super_admin) return res.status(403).json({success:false,message:'Admin required'});
  next();
});
app.get('/api/admin/dashboard',(req,res)=>res.json({all_users:Object.values(users),stats:{total_users:3,total_donors:3,total_orders:0,pending_orders:0,total_products:0,pending_verifications:0,urgent_requests:0,unread_messages:0},current_notice:'',settings:{}}));
app.get('/api/support/admin/stream',(req,res)=>{res.type('text/event-stream');res.write(': connected\n\n');req.on('close',()=>res.end());});
const responses={
 '/api/admin/orders':{orders:[]}, '/api/admin/products':{products:[]},
 '/api/admin/activity':{events:[]}, '/api/support/admin/sessions':{sessions:[],unread_total:0},
 '/api/messages/admin/list':{messages:[],unread:0}, '/api/admin/settings':{settings:{}},
 '/api/admin/branding':{settings:{}}, '/api/admin/smtp':{settings:{}}, '/api/admin/smtp/log':{logs:[]},
 '/api/ai/admin/config':{settings:{},models:[]}, '/api/ai/admin/conversations':{conversations:[]},
 '/api/ai/admin/knowledge':{}, '/api/admin/content/antid':{entries:[]},
 '/api/admin/content/resources':{resources:[]}, '/api/reviews/admin':{reviews:[],counts:{pending:0,approved:0,rejected:0}},
};
for(const [path,data] of Object.entries(responses)) app.get(path,(req,res)=>res.json(data));
app.use((req,res)=>res.status(404).json({success:false,message:`Unimplemented test contract: ${req.method} ${req.path}`}));
app.listen(4597,'127.0.0.1',()=>console.log('Test API fixtures ready'));
