// ==================== BloodOra Frontend - i18n (English / বাংলা / العربية) ====================
// A single dictionary drives the whole interface. The active language comes from
// the `lang` cookie (falls back to the session, then the admin-configured
// default). Arabic switches the document to right-to-left.

export const LANGUAGES = [
  { code: "en", label: "English", native: "English", dir: "ltr", flag: "🇬🇧" },
  { code: "bn", label: "Bengali", native: "বাংলা", dir: "ltr", flag: "🇧🇩" },
  { code: "ar", label: "Arabic", native: "العربية", dir: "rtl", flag: "🇸🇦" },
];

export const SUPPORTED = LANGUAGES.map((l) => l.code);
export const DEFAULT_LANG = "en";

export function langMeta(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

const dict = {
  // ---------- navigation ----------
  nav_home:        { en: "Home",              bn: "হোম",                    ar: "الرئيسية" },
  nav_donors:      { en: "Donors",            bn: "দাতা",                   ar: "المتبرعون" },
  nav_requests:    { en: "Blood Requests",    bn: "রক্তের আবেদন",           ar: "طلبات الدم" },
  nav_request:     { en: "Request Blood",     bn: "রক্তের আবেদন করুন",       ar: "اطلب دم" },
  nav_shop:        { en: "Shop",              bn: "দোকান",                  ar: "المتجر" },
  nav_resources:   { en: "Resources",         bn: "রিসোর্স",                ar: "الموارد" },
  nav_compatibility:{ en: "Compatibility",    bn: "সামঞ্জস্যতা",             ar: "التوافق" },
  nav_antid:       { en: "Anti-D Information",bn: "অ্যান্টি-ডি তথ্য",        ar: "معلومات مضاد D" },
  nav_reviews:     { en: "Reviews",           bn: "রিভিউ",                  ar: "التقييمات" },
  nav_education:   { en: "Educational Resources", bn: "শিক্ষামূলক রিসোর্স",  ar: "موارد تعليمية" },
  nav_guidelines:  { en: "Donation Guidelines", bn: "দানের নির্দেশিকা",      ar: "إرشادات التبرع" },
  nav_faq:         { en: "FAQ",               bn: "সাধারণ প্রশ্ন",           ar: "الأسئلة الشائعة" },
  nav_contact:     { en: "Contact Us",        bn: "যোগাযোগ",                ar: "اتصل بنا" },
  nav_cart:        { en: "Cart",              bn: "কার্ট",                  ar: "السلة" },
  nav_login:       { en: "Login",             bn: "লগইন",                   ar: "تسجيل الدخول" },
  nav_register:    { en: "Register",          bn: "নিবন্ধন",                 ar: "إنشاء حساب" },
  nav_admin:       { en: "Admin",             bn: "অ্যাডমিন",               ar: "المشرف" },
  nav_my_orders:   { en: "My Orders",         bn: "আমার অর্ডার",             ar: "طلباتي" },
  nav_my_profile:  { en: "My Profile",        bn: "আমার প্রোফাইল",           ar: "ملفي" },
  nav_messages:    { en: "Messages",          bn: "বার্তা",                 ar: "الرسائل" },
  nav_edit_profile:{ en: "Edit Profile",      bn: "প্রোফাইল সম্পাদনা",       ar: "تعديل الملف" },
  nav_logout:      { en: "Logout",            bn: "লগআউট",                  ar: "تسجيل الخروج" },
  nav_language:    { en: "Language",          bn: "ভাষা",                   ar: "اللغة" },
  nav_apply_verify:{ en: "Apply for Verification", bn: "ভেরিফিকেশনের আবেদন", ar: "طلب التوثيق" },
  nav_switch_back: { en: "Switch back to Admin", bn: "অ্যাডমিনে ফিরে যান",   ar: "العودة كمشرف" },

  // ---------- generic ----------
  common_search:   { en: "Search",            bn: "খুঁজুন",                  ar: "بحث" },
  common_view:     { en: "View",              bn: "দেখুন",                   ar: "عرض" },
  common_submit:   { en: "Submit",            bn: "জমা দিন",                 ar: "إرسال" },
  common_save:     { en: "Save",              bn: "সংরক্ষণ",                 ar: "حفظ" },
  common_cancel:   { en: "Cancel",            bn: "বাতিল",                   ar: "إلغاء" },
  common_back:     { en: "Back",              bn: "ফিরে যান",                ar: "رجوع" },
  common_send:     { en: "Send",              bn: "পাঠান",                   ar: "إرسال" },
  common_loading:  { en: "Loading…",          bn: "লোড হচ্ছে…",              ar: "جارٍ التحميل…" },
  common_all:      { en: "All",               bn: "সব",                      ar: "الكل" },
  common_featured: { en: "Featured",          bn: "ফিচার্ড",                 ar: "مميز" },
  common_read_more:{ en: "Read more",         bn: "আরও পড়ুন",               ar: "اقرأ المزيد" },
  common_minutes:  { en: "min read",          bn: "মিনিট পড়া",              ar: "دقائق قراءة" },
  common_updated:  { en: "Updated",           bn: "হালনাগাদ",                ar: "محدّث" },
  common_retry:    { en: "Try again",         bn: "আবার চেষ্টা করুন",        ar: "حاول مرة أخرى" },

  // ---------- home ----------
  home_hero_badge: { en: "Bangladesh's Trusted Network", bn: "বাংলাদেশের বিশ্বস্ত নেটওয়ার্ক", ar: "شبكة بنغلاديش الموثوقة" },
  home_hero_title: { en: "Donate Blood, Save Lives", bn: "রক্ত দিন, জীবন বাঁচান", ar: "تبرّع بالدم، أنقذ حياة" },
  home_hero_lead:  { en: "Bangladesh's smart blood donation platform — find verified donors, post a request in seconds, and get medicines delivered to your door.", bn: "বাংলাদেশের স্মার্ট রক্তদান প্ল্যাটফর্ম — যাচাইকৃত দাতা খুঁজুন, কয়েক সেকেন্ডে আবেদন করুন, আর ওষুধ পৌঁছে যাবে আপনার দরজায়।", ar: "منصة بنغلاديش الذكية للتبرع بالدم — ابحث عن متبرعين موثّقين، وانشر طلبًا في ثوانٍ، واحصل على الأدوية حتى بابك." },
  home_cta_request:{ en: "Request Blood",     bn: "রক্তের আবেদন",             ar: "اطلب دم" },
  home_cta_donors: { en: "Find Donors",       bn: "দাতা খুঁজুন",              ar: "ابحث عن متبرعين" },
  home_cta_shop:   { en: "Shop Medicine",     bn: "ওষুধ কিনুন",               ar: "تسوّق الأدوية" },
  home_live:       { en: "Live Activity",     bn: "লাইভ কার্যকলাপ",           ar: "النشاط المباشر" },
  home_live_on:    { en: "Live",              bn: "লাইভ",                     ar: "مباشر" },
  home_live_wait:  { en: "Connecting to the live feed…", bn: "লাইভ ফিডে সংযোগ হচ্ছে…", ar: "جارٍ الاتصال بالبث المباشر…" },
  home_live_empty: { en: "No activity yet — the first verified donor or blood request will appear here in real time.", bn: "এখনো কোনো কার্যকলাপ নেই — প্রথম যাচাইকৃত দাতা বা রক্তের আবেদন এখানে সঙ্গে সঙ্গে দেখা যাবে।", ar: "لا يوجد نشاط بعد — سيظهر أول متبرع موثّق أو أول طلب دم هنا فورًا." },
  home_verified:   { en: "Verified Donors",   bn: "যাচাইকৃত দাতা",            ar: "متبرعون موثّقون" },
  home_urgent:     { en: "Urgent Cases",      bn: "জরুরি কেস",                ar: "حالات عاجلة" },
  home_districts:  { en: "Districts Covered", bn: "জেলা কভারেজ",              ar: "المناطق المغطاة" },
  home_groups:     { en: "Blood Groups",      bn: "রক্তের গ্রুপ",             ar: "فصائل الدم" },
  home_how:        { en: "How BloodOra Works", bn: "যেভাবে কাজ করে",           ar: "كيف يعمل الموقع" },
  home_recent_donors: { en: "Recent Verified Donors", bn: "সাম্প্রতিক যাচাইকৃত দাতা", ar: "أحدث المتبرعين الموثّقين" },
  home_urgent_requests: { en: "Urgent Blood Requests", bn: "জরুরি রক্তের আবেদন", ar: "طلبات دم عاجلة" },
  home_view_all:   { en: "View all",          bn: "সব দেখুন",                 ar: "عرض الكل" },

  // ---------- shop ----------
  shop_title:      { en: "Medical Shop",      bn: "মেডিকেল দোকান",            ar: "المتجر الطبي" },
  shop_sub:        { en: "Medicines • Healthcare • Supplements • Equipment — genuine products delivered in Kalai.", bn: "ওষুধ • স্বাস্থ্যসেবা • সাপ্লিমেন্ট • যন্ত্রপাতি — কলাইতে পৌঁছে দেওয়া আসল পণ্য।", ar: "أدوية • رعاية صحية • مكمّلات • أجهزة — منتجات أصلية تُوصَل في كالاي." },
  shop_view_cart:  { en: "View Cart",         bn: "কার্ট দেখুন",               ar: "عرض السلة" },
  shop_all_cats:   { en: "All Categories",    bn: "সব ক্যাটাগরি",             ar: "كل الفئات" },
  shop_filter:     { en: "Filter",            bn: "ফিল্টার",                  ar: "تصفية" },
  shop_add:        { en: "Add",               bn: "যোগ করুন",                 ar: "أضف" },
  shop_in_stock:   { en: "In Stock",          bn: "স্টকে আছে",                ar: "متوفر" },
  shop_out:        { en: "Out of Stock",      bn: "স্টক শেষ",                 ar: "نفد المخزون" },
  shop_sold_out:   { en: "Sold Out",          bn: "বিক্রি শেষ",               ar: "نفد" },
  shop_none:       { en: "No products found", bn: "কোনো পণ্য পাওয়া যায়নি",     ar: "لا توجد منتجات" },
  shop_delivery:   { en: "Delivery only in Kalai (৳10)", bn: "শুধু কলাইতে ডেলিভারি (৳১০)", ar: "التوصيل في كالاي فقط (৳10)" },

  // ---------- reviews ----------
  rev_title:       { en: "Reviews & Testimonials", bn: "রিভিউ ও প্রশংসাপত্র",   ar: "التقييمات والشهادات" },
  rev_sub:         { en: "Real feedback from donors, patients and shop customers.", bn: "দাতা, রোগী ও ক্রেতাদের সত্যিকারের মতামত।", ar: "آراء حقيقية من المتبرعين والمرضى وعملاء المتجر." },
  rev_write:       { en: "Write a Review",    bn: "রিভিউ লিখুন",              ar: "اكتب تقييمًا" },
  rev_all:         { en: "All reviews",       bn: "সব রিভিউ",                 ar: "كل التقييمات" },
  rev_product:     { en: "Product reviews",   bn: "পণ্য রিভিউ",               ar: "تقييمات المنتجات" },
  rev_site:        { en: "Testimonials",      bn: "প্রশংসাপত্র",               ar: "شهادات" },
  rev_avg:         { en: "Average rating",    bn: "গড় রেটিং",                 ar: "متوسط التقييم" },
  rev_count:       { en: "reviews",           bn: "টি রিভিউ",                 ar: "تقييمًا" },
  rev_rating:      { en: "Your rating",       bn: "আপনার রেটিং",              ar: "تقييمك" },
  rev_heading:     { en: "Review title",      bn: "রিভিউয়ের শিরোনাম",         ar: "عنوان التقييم" },
  rev_body:        { en: "Your review",       bn: "আপনার রিভিউ",              ar: "تقييمك" },
  rev_pending:     { en: "Awaiting moderation", bn: "অনুমোদনের অপেক্ষায়",      ar: "بانتظار المراجعة" },
  rev_approved:    { en: "Published",         bn: "প্রকাশিত",                 ar: "منشور" },
  rev_rejected:    { en: "Not published",     bn: "প্রকাশিত নয়",              ar: "غير منشور" },
  rev_official:    { en: "Official reply from BloodOra", bn: "BloodOra-র সরকারি উত্তর", ar: "رد رسمي من BloodOra" },
  rev_none:        { en: "No reviews yet. Be the first to share your experience.", bn: "এখনো কোনো রিভিউ নেই। প্রথম হয়ে আপনার অভিজ্ঞতা জানান।", ar: "لا توجد تقييمات بعد. كن أول من يشارك تجربته." },
  rev_login_first: { en: "Please login to write a review.", bn: "রিভিউ লিখতে লগইন করুন।", ar: "يرجى تسجيل الدخول لكتابة تقييم." },

  // ---------- chat / AI ----------
  chat_title:      { en: "Live Messaging",    bn: "লাইভ মেসেজিং",             ar: "المراسلة المباشرة" },
  chat_ai_title:   { en: "Live AI Help",      bn: "লাইভ এআই সহায়তা",          ar: "المساعد الذكي" },
  chat_ai_sub:     { en: "Ask me anything about BloodOra — pages, features, prices, Anti-D, compatibility.", bn: "BloodOra সম্পর্কে যা খুশি জিজ্ঞাসা করুন — পেজ, ফিচার, দাম, অ্যান্টি-ডি, সামঞ্জস্যতা।", ar: "اسألني أي شيء عن BloodOra — الصفحات والمزايا والأسعار ومضاد D والتوافق." },
  chat_placeholder:{ en: "Type your question…", bn: "আপনার প্রশ্ন লিখুন…",      ar: "اكتب سؤالك…" },
  chat_send:       { en: "Send",              bn: "পাঠান",                    ar: "إرسال" },
  chat_thinking:   { en: "Thinking…",         bn: "ভাবছে…",                   ar: "يفكّر…" },
  chat_human:      { en: "Talk to a human",   bn: "মানুষের সাথে কথা বলুন",     ar: "تحدث مع شخص" },
  chat_ai:         { en: "Ask the AI",        bn: "এআই-কে জিজ্ঞাসা করুন",      ar: "اسأل الذكاء الاصطناعي" },
  chat_offline:    { en: "The AI assistant is offline right now.", bn: "এআই সহায়ক এখন অফলাইন।", ar: "المساعد الذكي غير متصل حاليًا." },
  chat_you:        { en: "You",               bn: "আপনি",                     ar: "أنت" },
  chat_support:    { en: "Support",           bn: "সাপোর্ট",                  ar: "الدعم" },

  // ---------- footer ----------
  foot_platform:   { en: "Platform",          bn: "প্ল্যাটফর্ম",              ar: "المنصة" },
  foot_resources:  { en: "Resources",         bn: "রিসোর্স",                  ar: "الموارد" },
  foot_contact:    { en: "Contact",           bn: "যোগাযোগ",                  ar: "اتصل بنا" },
  foot_rights:     { en: "Crafted for lifesavers.", bn: "জীবনরক্ষাকারীদের জন্য তৈরি।", ar: "صُنع لمنقذي الأرواح." },

  // ---------- error pages ----------
  err_400_title:   { en: "Bad Request",       bn: "ভুল অনুরোধ",               ar: "طلب غير صالح" },
  err_400_body:    { en: "The request could not be understood. Check the address or the form fields and try again.", bn: "অনুরোধটি বোঝা যায়নি। ঠিকানা বা ফর্মের ঘরগুলো দেখে আবার চেষ্টা করুন।", ar: "تعذّر فهم الطلب. تحقّق من العنوان أو حقول النموذج ثم حاول مجددًا." },
  err_403_title:   { en: "Access Forbidden",  bn: "প্রবেশ নিষিদ্ধ",             ar: "الوصول ممنوع" },
  err_403_body:    { en: "You do not have permission to open this page. If you should, log in with an account that has the right role.", bn: "এই পেজে আপনার প্রবেশাধিকার নেই। প্রয়োজন হলে সঠিক রোলের অ্যাকাউন্ট দিয়ে লগইন করুন।", ar: "ليس لديك صلاحية لفتح هذه الصفحة. إن كان يجب أن تفتحها، سجّل الدخول بحساب يملك الدور المناسب." },
  err_404_title:   { en: "Page Not Found",    bn: "পেজ পাওয়া যায়নি",           ar: "الصفحة غير موجودة" },
  err_404_body:    { en: "The page you are looking for does not exist or has moved — but the donors, the blood requests and the medical shop are all still here.", bn: "আপনি যে পেজটি খুঁজছেন সেটি নেই বা সরে গেছে — তবে দাতা, রক্তের আবেদন আর মেডিকেল দোকান সবই আছে।", ar: "الصفحة التي تبحث عنها غير موجودة أو تم نقلها — لكن المتبرعين وطلبات الدم والمتجر الطبي ما زالت هنا." },
  err_500_title:   { en: "Something Went Wrong", bn: "কিছু একটা ভুল হয়েছে",     ar: "حدث خطأ ما" },
  err_500_body:    { en: "An unexpected error occurred on our side. Your cart and your data are safe — please try again.", bn: "আমাদের দিকে একটি অপ্রত্যাশিত ত্রুটি হয়েছে। আপনার কার্ট ও তথ্য নিরাপদ — আবার চেষ্টা করুন।", ar: "حدث خطأ غير متوقع من طرفنا. سلتك وبياناتك بأمان — يرجى المحاولة مرة أخرى." },
  err_home:        { en: "Go to Home",        bn: "হোমে যান",                 ar: "إلى الرئيسية" },
  err_shop:        { en: "Open the Shop",     bn: "দোকান খুলুন",              ar: "افتح المتجر" },
  err_login:       { en: "Login",             bn: "লগইন",                     ar: "تسجيل الدخول" },
  err_ai:          { en: "Ask the AI Assistant", bn: "এআই সহায়ককে জিজ্ঞাসা করুন", ar: "اسأل المساعد الذكي" },
  err_what:        { en: "Popular pages",     bn: "জনপ্রিয় পেজ",              ar: "صفحات شائعة" },
};

/**
 * Translate a key with optional {placeholder} interpolation.
 * Falls back to English, then to the key itself, so a missing entry can never
 * break a page render.
 */
export function translate(lang, key, vars = {}) {
  const entry = dict[key];
  let out = entry ? (entry[lang] ?? entry.en ?? key) : key;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

/** Build the per-request translator bound to the active language. */
export function makeT(lang) {
  return (key, vars) => translate(lang, key, vars);
}

export { dict };
