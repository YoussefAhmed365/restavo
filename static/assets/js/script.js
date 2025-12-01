// ----------------------------------------------------------------------
// المتغيرات العامة
// ----------------------------------------------------------------------
const API_BASE_URL = 'http://127.0.0.1:5000/api';
let currentUser = null; // {id, username}
let userFavorites = {}; // كائن لتخزين مفضّلات المستخدم محلياً {hotelName: true}
let authMode = 'login'; // 'login' or 'register'
let pendingBookingData = null; // لتخزين تفاصيل الحجز المعلق

// ----------------------------------------------------------------------
// 🌟 تحسين: دالة لإظهار إشعارات Toast (بديل لـ alert)
// ----------------------------------------------------------------------
let toastTimeout;
function showToast(message, isError = false) {
    const toast = document.getElementById('toast-message');
    if (!toast) return;

    // مسح أي مؤقت سابق
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }

    toast.textContent = message;
    toast.className = 'show'; // إزالة الفئات القديمة وبدء العرض
    if (isError) {
        toast.classList.add('error');
    } else {
        toast.classList.add('success');
    }

    // إخفاء الـ toast بعد 3 ثوانٍ
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}


// ----------------------------------------------------------------------
// وظائف مساعدة لفتح وإغلاق نافذة التسجيل
// ----------------------------------------------------------------------
const authModal = document.getElementById('auth-modal');
function openAuthModal() {
    if (authModal) {
        authModal.classList.remove('hidden');
        authMode = 'login';
        updateAuthModalState();
        document.getElementById('email').focus();
    }
}

function closeAuthModal() {
    if (authModal) {
        authModal.classList.add('hidden');
    }
}

// ----------------------------------------------------------------------
// 🌟 إصلاح أمني: منطق الشات بوت والذكاء الاصطناعي (Gemini)
// تم التعديل ليستدعي الخادم (app.py) بدلاً من Google مباشرة
// ----------------------------------------------------------------------
let CHAT_HISTORY = [{
    role: "model",
    parts: [{
        text: "مرحباً! أنا مساعدك الذكي في Restavo. اسألني عن أفضل وجهة، أو معلومات عن حجوزاتك، أو وجهات السفر!"
    }]
}];

// 🌟 إزالة: تم حذف API_KEY و GEMINI_API_URL (ثغرة أمنية)
// const GEMINI_MODEL = ...
// const API_KEY = ...
// const GEMINI_API_URL = ...
// const SYSTEM_INSTRUCTION = ... (تم نقله للخادم)

async function fetchWithBackoff(url, options, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status !== 429) { // 429 Too Many Requests
                return response;
            }
            // Exponential backoff
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error('Max retries reached.');
}

async function callGeminiApi() {
    // 🌟 تحسين: استخراج الرسالة الأخيرة فقط لإرسالها للخادم
    const lastUserMessage = CHAT_HISTORY.findLast(m => m.role === 'user');
    if (!lastUserMessage) {
        console.error("No user message found to send.");
        return;
    }
    const userPrompt = lastUserMessage.parts[0].text;

    // 🌟 تحسين: بناء الحمولة التي يتوقعها الخادم
    const payload = {
        prompt: userPrompt
    };

    try {
        // 🌟 تحسين: استدعاء نقطة النهاية الآمنة في الخادم (app.py)
        const response = await fetchWithBackoff(`${API_BASE_URL}/gemini/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // 🌟 ملاحظة: لا نحتاج credentials: 'include' هنا لأن هذا الـ endpoint عام
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok && result.response) {
            const modelText = result.response;
            CHAT_HISTORY.push({
                role: "model",
                parts: [{ text: modelText }]
            });
        } else {
            console.error("Backend API returned an error:", result);
            const errorText = result.response || "عذراً، حدث خطأ أثناء معالجة طلبك.";
            CHAT_HISTORY.push({ role: "model", parts: [{ text: errorText }] });
        }

    } catch (error) {
        console.error("Error calling Backend API:", error);
        const errorText = "عذراً، لا يمكن الاتصال بالخادم حالياً. يرجى التحقق من اتصالك.";
        CHAT_HISTORY.push({ role: "model", parts: [{ text: errorText }] });
    } finally {
        document.getElementById('chat-input').disabled = false;
        document.getElementById('chat-send-btn').disabled = false;
        renderChat();
    }
}

function sendMessage() {
    const inputElement = document.getElementById('chat-input');
    const message = inputElement.value.trim();

    if (message === "") return;

    inputElement.disabled = true;
    document.getElementById('chat-send-btn').disabled = true;
    inputElement.value = '';

    CHAT_HISTORY.push({
        role: "user",
        parts: [{ text: message }]
    });

    renderChat(true); // عرض رسالة المستخدم + مؤشر التحميل
    callGeminiApi(); // استدعاء الـ API
}

function renderChat(isLoading = false) {
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';

    CHAT_HISTORY.forEach(message => {
        // 🌟 إصلاح: التأكد من أن النص هو نص وليس كائن
        const text = (typeof message.parts === 'string') ? message.parts : message.parts[0].text;
        const isUser = message.role === 'user';

        const messageHtml = `
            <div class="flex ${isUser ? 'justify-end' : 'justify-start'}">
                <div class="p-3 rounded-xl max-w-[80%] shadow-md ${isUser
                ? 'bg-blue-500 text-white rounded-bl-sm'
                : 'bg-gray-100 text-gray-800 rounded-tr-sm'}">
                    ${text.replace(/\n/g, '<br>')}
                </div>
            </div>
        `;
        messagesContainer.insertAdjacentHTML('beforeend', messageHtml);
    });

    if (isLoading) {
        const loadingHtml = `
            <div class="flex justify-start" id="loading-indicator">
                <div class="bg-gray-100 text-gray-800 p-3 rounded-xl rounded-tr-sm max-w-[80%] shadow-md">
                    <div class="flex items-center space-x-2 space-x-reverse">
                        <div class="w-3 h-3 bg-gray-400 rounded-full animate-bounce"></div>
                        <div class="w-3 h-3 bg-gray-400 rounded-full animate-bounce delay-150"></div>
                        <div class="w-3 h-3 bg-gray-400 rounded-full animate-bounce delay-300"></div>
                    </div>
                </div>
            </div>
        `;
        messagesContainer.insertAdjacentHTML('beforeend', loadingHtml);
    }

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ----------------------------------------------------------------------
// منطق الحجز
// ----------------------------------------------------------------------
window.bookHotel = async (hotelName, city, checkIn, checkOut, price) => {

    // 🌟 إصلاح: التحقق من 'currentUser' بدلاً من 'userId' غير المعرف
    if (currentUser) {
        const bookingData = {
            hotel_name: hotelName,
            city: city,
            check_in: checkIn,
            check_out: checkOut,
            price: price,
            hotel_image_url: `https://placehold.co/150x150/f0f0f0/333?text=${encodeURIComponent(city.replace(/\s/g, '+'))}`
        };

        try {
            // نستخدم `credentials: 'include'` لإرسال الكوكيز الخاصة بالجلسة
            const response = await fetch(`${API_BASE_URL}/booking`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(bookingData)
            });

            const result = await response.json();

            if (response.ok) {
                // 🌟 تحسين: استخدام showToast بدلاً من alert
                showToast(`✅ تم تأكيد حجزك يا ${currentUser.username} في ${hotelName} بنجاح!`);
                console.log("Booking Confirmed:", result);
                // 🌟 إضافة: هنا يمكنك استدعاء دالة تحليل الحجز إذا أردت
                // analyzeBooking(result.booking_id);
            } else {
                showToast(`❌ فشل الحجز: ${result.message}`, true);
            }
        } catch (error) {
            showToast("❌ فشل الاتصال بخادم الحجز. تأكد من تشغيل 'python app.py'.", true);
            console.error("Network Error during booking:", error);
        }

    } else {
        // إذا لم يكن مسجلاً دخوله، نخزن تفاصيل الحجز ونعرض نافذة التسجيل
        pendingBookingData = {
            hotel_name: hotelName,
            city: city,
            check_in: checkIn,
            check_out: checkOut,
            price: price
        };

        openAuthModal();
        // 🌟 تحسين: استخدام showToast بدلاً من alert
        showToast("يرجى تسجيل الدخول أو إنشاء حساب لإتمام حجزك.");
    }
};

// ----------------------------------------------------------------------
// منطق المصادقة (Auth Logic)
// ----------------------------------------------------------------------
function updateAuthModalState() {
    const loginTab = document.getElementById('login-tab');
    const registerTab = document.getElementById('register-tab');
    const submitBtn = document.getElementById('auth-submit-btn');
    const errorMsg = document.getElementById('auth-error-message');
    
    // إخفاء رسالة الخطأ عند التبديل
    errorMsg.textContent = '';
    errorMsg.classList.add('hidden');

    if (authMode === 'login') {
        loginTab.classList.add('border-brand-color', 'text-brand-text', 'font-bold');
        loginTab.classList.remove('border-gray-200', 'text-gray-500');
        registerTab.classList.remove('border-brand-color', 'text-brand-text', 'font-bold');
        registerTab.classList.add('border-gray-200', 'text-gray-500');
        submitBtn.textContent = 'تسجيل الدخول';
    } else { // register
        registerTab.classList.add('border-brand-color', 'text-brand-text', 'font-bold');
        registerTab.classList.remove('border-gray-200', 'text-gray-500');
        loginTab.classList.remove('border-brand-color', 'text-brand-text', 'font-bold');
        loginTab.classList.add('border-gray-200', 'text-gray-500');
        submitBtn.textContent = 'إنشاء حساب جديد';
    }
}

async function handleAuthSubmission() {
    const username = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('auth-error-message');
    const submitBtn = document.getElementById('auth-submit-btn');

    errorMsg.textContent = '';
    errorMsg.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري المعالجة...';

    if (username === "" || password === "") {
        errorMsg.textContent = 'الرجاء إدخال البريد الإلكتروني وكلمة المرور.';
        errorMsg.classList.remove('hidden');
        submitBtn.disabled = false;
        updateAuthModalState();
        return;
    }

    const endpoint = authMode === 'login' ? '/login' : '/register';

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // إرسال واستقبال الكوكيز
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (response.ok) {
            if (authMode === 'login') {
                // 🌟 تحسين: استخدام showToast بدلاً من alert
                showToast(result.message);
                currentUser = { id: result.user_id, username: result.username };
                updateUserUI();
                closeAuthModal();
                
                // 🌟 جلب المفضلة الخاصة بالمستخدم بعد تسجيل الدخول
                await fetchAndRenderFavorites();

                // إذا كان هناك حجز معلق، قم بتنفيذه الآن
                if (pendingBookingData) {
                    showToast(`جاري إتمام حجزك في ${pendingBookingData.hotel_name}...`);
                    await window.bookHotel(
                        pendingBookingData.hotel_name,
                        pendingBookingData.city,
                        pendingBookingData.check_in,
                        pendingBookingData.check_out,
                        pendingBookingData.price
                    );
                    pendingBookingData = null; // مسح البيانات المعلقة
                }
            } else { // register
                showToast(result.message);
                authMode = 'login';
                updateAuthModalState();
            }
        } else {
            errorMsg.textContent = result.message || 'حدث خطأ غير متوقع.';
            errorMsg.classList.remove('hidden');
        }
    } catch (error) {
        errorMsg.textContent = 'فشل الاتصال بالخادم. يرجى المحاولة مرة أخرى.';
        errorMsg.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        if (authMode === 'register' && !errorMsg.textContent) {
            // لا تغير النص إذا كان التسجيل ناجحًا
        } else {
            updateAuthModalState();
        }
    }
}

async function handleLogout() {
    try {
        const response = await fetch(`${API_BASE_URL}/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        const result = await response.json();
        showToast(result.message);
        currentUser = null;
        userFavorites = {}; // مسح المفضلة المحلية
        updateUserUI();
        // 🌟 تحديث الواجهة لإزالة المفضلة
        await fetchAndRenderFavorites(); 
    } catch (error) {
        showToast('فشل تسجيل الخروج. حاول مرة أخرى.', true);
    }
}

async function checkLoginStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/status`, { credentials: 'include' });
        const result = await response.json();
        if (result.is_authenticated) {
            currentUser = { id: result.user_id, username: result.username };
        } else {
            currentUser = null;
        }
        updateUserUI();
    } catch (error) {
        console.error("Could not check login status:", error);
        currentUser = null;
        updateUserUI();
    }
}

function updateUserUI() {
    const userDisplay = document.getElementById('user-display');
    const authBtn = document.getElementById('auth-action-btn');

    if (currentUser) {
        let displayName = currentUser.username;
        
        // 🌟🌟 التعديل هنا لإخفاء الإيميل 🌟🌟
        // 1. التحقق مما إذا كانت القيمة تبدو كإيميل (تحتوي على @)
        if (displayName && typeof displayName === 'string' && displayName.includes('@')) {
            // 2. استخراج الجزء الذي يسبق @ (مثل "18miraashraf")
            displayName = displayName.split('@')[0];
            
            // 3. احتياطي: إذا كان الناتج فارغًا، نستخدم "مستخدم"
            if (displayName.trim() === '') {
                displayName = 'مستخدم';
            }
        } else if (!displayName) {
             displayName = 'مستخدم'; 
        }
        // 🌟🌟 نهاية التعديل 🌟🌟

        userDisplay.textContent = `مرحباً، ${displayName}`; // استخدام الاسم المُعدَّل
        userDisplay.classList.remove('hidden');
        authBtn.innerHTML = `<i data-lucide="log-out" class="w-4 h-4"></i><span>تسجيل الخروج</span>`;
        authBtn.onclick = handleLogout;
    } else {
        userDisplay.classList.add('hidden');
        authBtn.innerHTML = `<i data-lucide="user-plus" class="w-4 h-4"></i><span>حسابي</span>`;
        authBtn.onclick = openAuthModal;
    }
    lucide.createIcons();
}
// ----------------------------------------------------------------------
// 🌟 إصلاح: دالة مساعدة لتحديث زر المفضلة (كانت مفقودة)
// ----------------------------------------------------------------------
function updateFavoriteButton(cardElement, isFavorite) {
    if (!cardElement) return;
    const favBtn = cardElement.querySelector('.favorite-btn');
    if (favBtn) {
        const heartIcon = favBtn.querySelector('i[data-lucide="heart"]');
        if (isFavorite) {
            favBtn.classList.add('text-red-500');
            favBtn.classList.remove('text-gray-400');
            // 🌟 إضافة fill-current لإصلاح الواجهة
            if (heartIcon) heartIcon.classList.add('fill-current');
        } else {
            favBtn.classList.remove('text-red-500');
            favBtn.classList.add('text-gray-400');
             // 🌟 إزالة fill-current لإصلاح الواجهة
            if (heartIcon) heartIcon.classList.remove('fill-current');
        }
    }
}

// ----------------------------------------------------------------------
// 🌟 إصلاح: منطق المفضَّلات (تم إصلاح المصادقة والمنطق)
// ----------------------------------------------------------------------
window.toggleFavorite = async (hotelName, city, cardElement) => {
    // 🌟 إصلاح: التحقق من 'currentUser' بدلاً من 'userId'
    if (!currentUser) { 
        openAuthModal();
        showToast("الرجاء تسجيل الدخول أو إنشاء حساب لإضافة مفضلة.");
        return;
    }

    const isCurrentlyFavorite = userFavorites[hotelName] || false;

    try {
        // 🌟 إصلاح: إضافة credentials: 'include' لإرسال كوكي الجلسة
        const response = await fetch(`${API_BASE_URL}/favorites/toggle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ item_name: hotelName, city: city })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // تحديث الحالة المحلية وقاعدة بيانات Flask
            userFavorites[hotelName] = result.is_favorite;
            updateFavoriteButton(cardElement, result.is_favorite);

            // 🌟 تحسين: لا داعي لاستدعاء fetchAndRenderFavorites() هنا
            // هذا يسبب طلب شبكة غير ضروري. نكتفي بتحديث الواجهة مباشرة.
            // fetchAndRenderFavorites(); 

        } else if (response.status === 401) {
            openAuthModal();
            showToast("الرجاء تسجيل الدخول لإضافة مفضلة.", true);
        } else {
            showToast(`❌ فشل التفضيل: ${result.message || 'خطأ غير معروف'}`, true);
            console.error("Favorite Toggle Failed:", result);
        }

    } catch (error) {
        showToast("❌ فشل الاتصال بخادم المفضلة.", true);
        console.error("Network Error during favorite toggle:", error);
    }
};

async function fetchAndRenderFavorites() {
    const favoritesListContainer = document.getElementById('favorites-list');
    const favoritesCountElement = document.getElementById('favorites-count');
    const favoritesTitleElement = document.getElementById('favorites-title');

    // تهيئة حالة التحميل
    favoritesListContainer.innerHTML = '<p class="text-center text-gray-500 mt-10">جاري تحميل المفضَّلات...</p>';
    favoritesCountElement.textContent = '0';
    favoritesCountElement.classList.add('opacity-0');
    favoritesTitleElement.textContent = `فنادقك المفضلة (0)`;

    // 🌟 إصلاح: التحقق من 'currentUser' بدلاً من 'userId'
    if (!currentUser) { 
        favoritesListContainer.innerHTML = `
            <div class="text-center p-10 bg-gray-50 rounded-lg">
                <i data-lucide="lock" class="w-12 h-12 text-red-400 mx-auto mb-4"></i>
                <p class="text-lg text-gray-600">الرجاء تسجيل الدخول لعرض مفضَّلاتك.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    try {
        // 🌟 إصلاح: إضافة credentials: 'include'
        const response = await fetch(`${API_BASE_URL}/favorites`, {
            method: 'GET',
            credentials: 'include' 
        });

        if (response.status === 401) {
            favoritesListContainer.innerHTML = '<p class="text-center text-red-500 mt-10">فشل المصادقة. يرجى تسجيل الدخول.</p>';
            return;
        }

        const favoritesData = await response.json(); // [ {item_name, city}, ... ]

        // بناء قائمة المفضلة المحلية من البيانات المسترجعة
        const newFavorites = {};
        favoritesData.forEach(fav => {
            // 🌟 إصلاح: يجب أن يكون الكائن { city: fav.city } أو true فقط
            newFavorites[fav.item_name] = true; 
        });
        userFavorites = newFavorites; // تحديث الكائن المحلي

        // فلترة الفنادق المحاكية بناءً على المفضلة المسترجعة
        const favoriteHotels = SIMULATED_HOTELS.filter(hotel => userFavorites[hotel.name]);

        // ... منطق العرض (renderFavoritesList) ...
        favoritesListContainer.innerHTML = ''; // مسح رسالة التحميل

        const count = favoriteHotels.length;
        favoritesCountElement.textContent = count;
        favoritesTitleElement.textContent = `فنادقك المفضلة (${count})`;
        favoritesCountElement.classList.toggle('opacity-0', count === 0);

        if (count === 0) {
            favoritesListContainer.innerHTML = `
                <div class="text-center p-10 bg-gray-50 rounded-lg">
                    <i data-lucide="heart-crack" class="w-12 h-12 text-gray-400 mx-auto mb-4"></i>
                    <p class="text-lg text-gray-600">لم تقم بإضافة أي فندق للمفضلة بعد.</p>
                    <p class="text-sm text-gray-500 mt-2">ابحث عن الفنادق واضغط على أيقونة القلب لإضافتها.</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        favoriteHotels.forEach(hotel => {
            const cardHtml = `
                <div class="bg-white p-4 rounded-lg shadow-lg border border-gray-200 flex items-center justify-between">
                    <div class="flex items-start gap-4">
                        <img src="${hotel.image_url}" alt="صورة ${hotel.name}" class="rounded-md w-16 h-16 object-cover flex-shrink-0">
                        <div>
                            <h4 class="text-lg font-bold text-gray-800">${hotel.name}</h4>
                            <p class="text-sm text-gray-500">${hotel.city} | ${hotel.rating} نجوم</p>
                        </div>
                    </div>
                    
                    <div class="flex flex-col items-end gap-2">
                        <!-- 🌟 إصلاح: التأكد من أن الزر يظهر القلب ممتلئاً دائماً هنا -->
                        <button class="favorite-btn text-red-500 hover:text-red-700 p-1 rounded-full transition duration-150"
                            onclick="toggleFavorite('${hotel.name.replace(/'/g, "\\'")}', '${hotel.city}', this.closest('.bg-white.p-4.rounded-lg.shadow-lg'))" aria-label="إزالة من المفضلة">
                            <i data-lucide="heart" class="w-5 h-5 fill-current"></i>
                        </button>
                        <div class="text-xl font-extrabold text-green-600">$${hotel.cheapest_price}</div>
                    </div>
                </div>
            `;
            favoritesListContainer.insertAdjacentHTML('beforeend', cardHtml);
        });
        lucide.createIcons();
        
        // 🌟 تحسين: تم إزالة استدعاء البحث من هنا لتجنب الحلقات اللانهائية
        // const searchForm = document.getElementById('search-form');
        // if (searchForm) {
        //    searchForm.dispatchEvent(new Event('submit'));
        // }

    } catch (error) {
        console.error("Error fetching favorites:", error);
        favoritesListContainer.innerHTML = '<p class="text-center text-red-500 mt-10">فشل في تحميل المفضَّلات.</p>';
    }
}


// ----------------------------------------------------------------------
// منطق تتبع الفنادق المشهورة - تم تبسيطه (لا يعتمد على بيانات)
// ----------------------------------------------------------------------
window.logSearchCount = async (hotelName) => {
    // هذه الدالة فارغة الآن. يمكن استبدالها بطلب للخادم لتسجيل البحث.
};

function setupPopularHotelsListener() {
    renderPopularHotels([]); // عرض قائمة فارغة مبدئياً
}

function renderPopularHotels(hotels) {
    const popularContainer = document.getElementById('popular-hotels-list');
    popularContainer.innerHTML = '';

    if (hotels.length === 0) {
        popularContainer.innerHTML = '<p class="text-center text-gray-500 col-span-full mt-4">ميزة الفنادق الشائعة قيد التطوير.</p>';
        return;
    }
    // ... (الكود المتبقي لعرض الفنادق الشائعة) ...
}

// ----------------------------------------------------------------------
// محاكاة البيانات ومنطق البحث
// (لم يتم تغيير هذا الجزء)
// ----------------------------------------------------------------------
const BOOKING_SITES = ["Booking.com", "Expedia", "Hotels.com", "Direct Hotel"];

const RAW_HOTELS_DATA = [
    { name: "Grand View Towers", city: "Dubai", rating: 4.5, amenities: ["مسبح", "واي فاي مجاني", "صالة رياضية"] },
    { name: "City Center Inn", city: "Dubai", rating: 3.8, amenities: ["واي فاي مجاني", "فطور مجاني"] },
    { name: "Luxury Resort Oasis", city: "Abu Dhabi", rating: 5.0, amenities: ["شاطئ خاص", "سبا", "مسبح"] },
    { name: "The Budget Stay", city: "Abu Dhabi", rating: 3.0, amenities: ["موقف سيارات", "واي فاي مجاني"] },
    { name: "Nile Panorama Hotel", city: "Cairo", rating: 4.2, amenities: ["إطلالة نهرية", "مطعم"] },
    { name: "Historical Boutique", city: "Cairo", rating: 4.0, amenities: ["تراس", "فطور مجاني"] },
    { name: "Palm Beach Hotel", city: "Dubai", rating: 4.7, amenities: ["وصول للشاطئ", "مسبح", "سبا"] },
    { name: "Desert Sands Villa", city: "Abu Dhabi", rating: 4.1, amenities: ["صالة رياضية", "واي فاي مجاني"] },
    { name: "Four Seasons Hotel Nile Plaza", city: "Cairo", rating: 4.9, amenities: ["سبا فاخر", "إطلالة على النيل", "مسبح على السطح"] },
    { name: "Marriott Mena House", city: "Giza", rating: 4.8, amenities: ["إطلالة على الأهرامات", "حدائق", "مطعم فاخر"] },
    { name: "Sofitel Legend Old Cataract", city: "Aswan", rating: 5.0, amenities: ["تاريخي", "إطلالة على النيل", "مسبح", "خدمة الأجنحة"] },
    { name: "Rixos Premium Seagate", city: "Sharm El Sheikh", rating: 4.6, amenities: ["شامل كلياً", "أكوا بارك", "وصول للشاطئ"] },
    { name: "Hilton Luxor Resort & Spa", city: "Luxor", rating: 4.4, amenities: ["سبا", "إطلالة نهرية", "مسبح إنفينيتي"] },
    { name: "The Oberoi Sahl Hasheesh", city: "Hurghada", rating: 4.8, amenities: ["أجنحة فاخرة", "شاطئ خاص", "غوص"] },
];

function generateSimulatedPrices(rating) {
    const basePriceFactor = parseInt(rating * 50);
    const minBase = 150 + basePriceFactor;
    const maxBase = 450 + basePriceFactor;
    const basePrice = Math.floor(Math.random() * (maxBase - minBase + 1)) + minBase;
    const prices = {};
    for (const site of BOOKING_SITES) {
        const variation = Math.random() * (1.05 - 0.95) + 0.95;
        prices[site] = Math.round(basePrice * variation);
    }
    return prices;
}

const SIMULATED_HOTELS = RAW_HOTELS_DATA.map(hotel => {
    const prices = generateSimulatedPrices(hotel.rating);
    let cheapestPrice = Infinity;
    let cheapestSite = "N/A";
    for (const site in prices) {
        if (prices[site] < cheapestPrice) {
            cheapestPrice = prices[site];
            cheapestSite = site;
        }
    }
    return {
        ...hotel,
        prices,
        cheapest_price: cheapestPrice,
        cheapest_site: cheapestSite,
        image_url: `https://placehold.co/150x150/f0f0f0/333?text=${encodeURIComponent(hotel.city.replace(/\s/g, '+'))}`
    };
});

function searchAndCompareDeals(city, minRating) {
    let matchingHotels = SIMULATED_HOTELS.filter(hotel => {
        const matchesCity = hotel.city.toLowerCase() === city.toLowerCase();
        const matchesRating = hotel.rating >= minRating;
        return matchesCity && matchesRating;
    });
    matchingHotels.sort((a, b) => a.cheapest_price - b.cheapest_price);

    // 🌟 تم تبسيط هذا، لا حاجة لاستدعاء logSearchCount إذا لم يكن الخادم يدعمه
    // if (currentUser) {
    //    matchingHotels.forEach(hotel => logSearchCount(hotel.name));
    // }

    return matchingHotels;
}

function renderResults(results, cityDisplay) {
    const titleElement = document.getElementById('results-title');
    const initialMessage = document.getElementById('initial-message');
    const cardsList = document.getElementById('hotel-cards-list');

    cardsList.innerHTML = '';

    if (initialMessage) {
        initialMessage.style.display = 'none';
    }

    if (results.length === 0) {
        titleElement.textContent = `لم يتم العثور على فنادق في ${cityDisplay}`;
        titleElement.classList.remove('hidden');
        cardsList.innerHTML = `<p class="text-xl text-center mt-8 text-gray-500">نأسف، لا توجد نتائج مطابقة لمعايير البحث في ${cityDisplay}.</p>`;
        return;
    }

    titleElement.textContent = `نتائج البحث في ${cityDisplay} (${results.length} فندق)`;
    titleElement.classList.remove('hidden');

    results.forEach(hotel => {
        // 🌟 إصلاح: التأكد من أن userFavorites محدث قبل العرض
        const isFavorite = userFavorites[hotel.name] || false;
        const favoriteClass = isFavorite ? 'text-red-500 fill-current' : 'text-gray-400';
        // 🌟 إصلاح: إضافة fill-current للزر إذا كان مفضلاً
        const fillClass = isFavorite ? 'fill-current' : '';


        const amenitiesHtml = hotel.amenities.map(amenity => `
            <span class="bg-gray-100 text-gray-700 text-xs font-semibold px-3 py-1 rounded-full shadow-sm">${amenity}</span>
        `).join('');

        let pricesHtml = '';
        for (const site in hotel.prices) {
            pricesHtml += `
                <div class="flex justify-between text-sm py-2 border-b last:border-b-0 border-gray-100 ${hotel.prices[site] === hotel.cheapest_price ? 'bg-green-50 font-bold' : ''}">
                    <span>${site}:</span>
                    <span class="text-right">$${hotel.prices[site]}</span>
                </div>
            `;
        }

        const hotelCardHtml = `
            <div class="bg-white rounded-xl shadow-xl mb-6 flex flex-col md:flex-row transform hover:shadow-2xl transition duration-300 border border-gray-100" id="card-${hotel.name.replace(/\s/g, '-')}">
                
                <div class="w-full md:w-56 flex-shrink-0 bg-gray-50 p-4 flex flex-col justify-between items-center text-center">
                    <img src="${hotel.image_url}" alt="صورة ${hotel.name}" class="rounded-lg mb-3 w-28 h-28 object-cover border border-gray-200">
                    
                    <div class="p-2 w-full brand-color text-white font-extrabold text-xl rounded-lg shadow-md">
                        ${hotel.rating} <span class="text-sm font-normal">/ 5.0</span>
                    </div>
                </div>

                <div class="p-6 flex flex-col justify-between w-full">
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="text-2xl font-bold text-gray-900 mb-2">${hotel.name}</h3>
                            <p class="text-sm text-gray-500 mb-4">${hotel.city}</p>
                        </div>
                        
                        <!-- 🌟 إصلاح: تطبيق الفئات الصحيحة عند العرض -->
                        <button class="favorite-btn p-2 rounded-full hover:bg-gray-100 transition duration-150 ${favoriteClass}"
                            onclick="toggleFavorite('${hotel.name.replace(/'/g, "\\'")}', '${hotel.city}', this.closest('.bg-white.rounded-xl.shadow-xl.mb-6'))">
                            <i data-lucide="heart" class="w-6 h-6 ${fillClass}"></i>
                        </button>

                    </div>

                    <div class="flex flex-wrap gap-2 mb-4">${amenitiesHtml}</div>

                    <div class="mt-4 pt-4 border-t border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center">
                        <div class="mb-4 sm:mb-0">
                            <p class="text-lg font-medium text-gray-600">أقل سعر لليلة واحدة:</p>
                            <p class="text-4xl font-extrabold text-green-600 mt-1">$${hotel.cheapest_price}</p>
                            <p class="text-sm text-gray-500">متاح على: <span class="font-semibold brand-text">${hotel.cheapest_site}</span></p>
                        </div>

                        <div class="flex gap-3 items-center">
                            <div class="relative group/comparison">
                                <button class="price-comparison-button brand-color hover:bg-[#4d3c16] text-white font-bold py-3 px-6 rounded-lg transition duration-200 shadow-xl whitespace-nowrap">
                                    عرض ${Object.keys(hotel.prices).length} عرض
                                </button>
                                
                                <div class="comparison-details absolute z-10 w-64 p-4 bg-white rounded-xl shadow-2xl border border-gray-200 opacity-0 group-hover/comparison:opacity-100 group-hover/comparison:block transition duration-300 pointer-events-none group-hover/comparison:pointer-events-auto transform right-[-50%] bottom-14 mt-3 -translate-y-2 group-hover/comparison:translate-y-0">
                                    <p class="text-base font-bold text-gray-700 mb-2 border-b pb-2">مقارنة أسعار المواقع:</p>
                                    ${pricesHtml}
                                </div>
                            </div>
                            
                            <button class="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition duration-200 shadow-xl whitespace-nowrap" 
                                onclick="bookHotel(
                                    '${hotel.name.replace(/'/g, "\\'")}', 
                                    '${hotel.city}', 
                                    document.getElementById('check_in').value, 
                                    document.getElementById('check_out').value, 
                                    ${hotel.cheapest_price}
                                )">
                                احجز الآن ($${hotel.cheapest_price})
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        cardsList.insertAdjacentHTML('beforeend', hotelCardHtml);
    });
    lucide.createIcons();
}

// ----------------------------------------------------------------------
// 🌟 تحسين: معالج حدث إرسال النموذج والتهيئة
// ----------------------------------------------------------------------
document.getElementById('search-form').addEventListener('submit', function (event) {
    event.preventDefault();

    const cityInput = document.getElementById('city');
    const ratingInput = document.getElementById('min_rating');

    const selectedCity = cityInput.value;
    const minRating = parseFloat(ratingInput.value);

    // 🌟 ملاحظة: userFavorites يجب أن يكون مُحمّلاً بالفعل
    const results = searchAndCompareDeals(selectedCity, minRating);

    renderResults(results, cityInput.options[cityInput.selectedIndex].text);
});

document.addEventListener('DOMContentLoaded', async () => {
    // 🌟 تحسين: ترتيب التحميل الصحيح
    // 1. تحقق من تسجيل الدخول
    await checkLoginStatus(); 
    
    // 2. جلب المفضلة (يعتمد على checkLoginStatus)
    await fetchAndRenderFavorites(); 

    // 3. عرض النتائج الأولية (الآن ستعرف ما هي المفضلة)
    const defaultCity = document.getElementById('city').value;
    const defaultRating = parseFloat(document.getElementById('min_rating').value);
    const initialResults = searchAndCompareDeals(defaultCity, defaultRating);
    renderResults(initialResults, document.getElementById('city').options[document.getElementById('city').selectedIndex].text);

    lucide.createIcons();

    // تهيئة واجهة الحجوزات
    const bookingsToggleBtn = document.getElementById('bookings-toggle-btn');
    const bookingsCloseBtn = document.getElementById('bookings-close-btn');
    const bookingsModal = document.getElementById('bookings-modal');

    if (bookingsToggleBtn && bookingsModal) {
        bookingsToggleBtn.addEventListener('click', () => {
            if (!currentUser) {
                openAuthModal();
                showToast("الرجاء تسجيل الدخول لعرض حجوزاتك.");
                return;
            }
            bookingsModal.classList.remove('hidden');
            fetchAndRenderBookings();
        });
    }
    if (bookingsCloseBtn && bookingsModal) {
        bookingsCloseBtn.addEventListener('click', () => {
            bookingsModal.classList.add('hidden');
        });
    }

    // تهيئة واجهة المفضلة
    const favoritesToggleBtn = document.getElementById('favorites-toggle-btn');
    const favoritesCloseBtn = document.getElementById('favorites-close-btn');
    const favoritesModal = document.getElementById('favorites-modal');

    favoritesToggleBtn.addEventListener('click', () => {
        favoritesModal.classList.remove('hidden');
        // 🌟 تحديث: جلب البيانات عند الفتح دائماً
        fetchAndRenderFavorites(); 
    });

    favoritesCloseBtn.addEventListener('click', () => {
        favoritesModal.classList.add('hidden');
    });

    // تهيئة واجهة التسجيل/تسجيل الدخول
    const authCloseBtn = document.getElementById('auth-close-btn');
    const loginTab = document.getElementById('login-tab');
    const registerTab = document.getElementById('register-tab');

    authCloseBtn.addEventListener('click', closeAuthModal);

    loginTab.addEventListener('click', () => {
        authMode = 'login';
        updateAuthModalState();
    });

    registerTab.addEventListener('click', () => {
        authMode = 'register';
        updateAuthModalState();
    });

    // تهيئة نافذة تحليل الذكاء الاصطناعي
    const aiAnalysisModal = document.getElementById('ai-analysis-modal');
    const aiAnalysisCloseBtn = document.getElementById('ai-analysis-close-btn');
    if (aiAnalysisModal && aiAnalysisCloseBtn) {
        aiAnalysisCloseBtn.addEventListener('click', () => {
            aiAnalysisModal.classList.add('hidden');
        });
    }

    document.getElementById('auth-form').addEventListener('submit', (event) => {
        event.preventDefault(); 
        handleAuthSubmission();
    });

    // تهيئة واجهة الشات بوت
    const chatToggleBtn = document.getElementById('chat-toggle-btn');
    const chatCloseBtn = document.getElementById('chat-close-btn');
    const chatWindow = document.getElementById('chat-window');
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');

    chatToggleBtn.addEventListener('click', () => {
        chatWindow.classList.toggle('hidden');
        if (!chatWindow.classList.contains('hidden')) {
            renderChat();
            chatInput.focus();
        }
    });

    chatCloseBtn.addEventListener('click', () => {
        chatWindow.classList.add('hidden');
    });

    chatInput.addEventListener('input', () => {
        chatSendBtn.disabled = chatInput.value.trim() === '';
    });

    chatSendBtn.addEventListener('click', sendMessage);

    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !chatSendBtn.disabled) {
            sendMessage();
        }
    });

    chatSendBtn.disabled = chatInput.value.trim() === '';

    // 🌟 إزالة: لم نعد بحاجة إلى setupFavoritesListener()
    // setupFavoritesListener();
    setupPopularHotelsListener();
});

// ----------------------------------------------------------------------
// 🌟 إضافة: منطق عرض وإدارة الحجوزات وتحليلها
// ----------------------------------------------------------------------
window.handleDeleteBooking = async (bookingId) => {
    if (!confirm("هل أنت متأكد من رغبتك في إلغاء هذا الحجز؟ لا يمكن التراجع عن هذا الإجراء.")) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/booking/${bookingId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await response.json();
        if (response.ok) {
            showToast(result.message);
            await fetchAndRenderBookings(); // تحديث القائمة
        } else {
            showToast(`❌ فشل الإلغاء: ${result.message}`, true);
        }
    } catch (error) {
        showToast("❌ فشل الاتصال بالخادم لإلغاء الحجز.", true);
    }
};

window.analyzeBooking = async (bookingId) => {
    const modal = document.getElementById('ai-analysis-modal');
    const content = document.getElementById('ai-analysis-content');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    content.innerHTML = `<div class="flex justify-center items-center h-48"><p>جاري تحليل حجزك بذكاء...</p></div>`;

    try {
        const response = await fetch(`${API_BASE_URL}/gemini/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ booking_id: bookingId })
        });
        const result = await response.json();
        if (!response.ok) { throw new Error(result.message || 'فشل التحليل'); }

        content.innerHTML = `
            <h4 class="text-2xl font-bold text-gray-800 mb-3">${result.title}</h4>
            <div class="p-4 bg-white rounded-lg border mb-3">
                <h5 class="font-bold text-lg mb-2 text-brand-text">📊 تحليل السعر</h5>
                <p class="text-gray-700">${result.price_analysis}</p>
            </div>
            <div class="p-4 bg-white rounded-lg border mb-3">
                <h5 class="font-bold text-lg mb-2 text-brand-text">🌴 اقتراحات للأنشطة</h5>
                <ul class="list-disc pr-5 space-y-2">${result.activity_suggestions.map(act => `<li><strong>${act.name}:</strong> ${act.reason}</li>`).join('')}</ul>
            </div>
            <div class="p-4 bg-green-50 text-green-800 rounded-lg border border-green-200">
                <h5 class="font-bold text-lg mb-2">💡 نصيحة للمسافر</h5>
                <p>${result.summary}</p>
            </div>
        `;
    } catch (error) {
        content.innerHTML = `<div class="text-center p-10 bg-red-50 rounded-lg"><p class="text-lg text-red-700">حدث خطأ: ${error.message}</p></div>`;
    }
};

async function fetchAndRenderBookings() {
    const container = document.getElementById('bookings-list');
    if (!container) return;
    container.innerHTML = '<p class="text-center text-gray-500 mt-10">جاري تحميل حجوزاتك...</p>';

    if (!currentUser) {
        container.innerHTML = `<div class="text-center p-10"><p>الرجاء تسجيل الدخول لعرض حجوزاتك.</p></div>`;
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/bookings`, { credentials: 'include' });
        if (!response.ok) { throw new Error('فشل جلب الحجوزات'); }
        const bookings = await response.json();
        
        document.getElementById('bookings-title').textContent = `حجوزاتي المؤكدة (${bookings.length})`;
        container.innerHTML = '';

        if (bookings.length === 0) {
            container.innerHTML = `<div class="text-center p-10"><p>لا يوجد لديك أي حجوزات حالياً.</p></div>`;
            return;
        }

        bookings.forEach(booking => {
            const cardHtml = `
                <div class="bg-white p-4 rounded-lg shadow-md border flex flex-col sm:flex-row items-start gap-4">
                    <img src="${booking.hotel_image_url || 'https://placehold.co/150x150'}" alt="${booking.hotel_name}" class="rounded-md w-full sm:w-24 h-24 object-cover">
                    <div class="flex-grow">
                        <h4 class="text-xl font-bold">${booking.hotel_name}</h4>
                        <p class="text-md text-gray-600">${booking.city}</p>
                        <div class="text-sm text-gray-500 mt-2">
                            <span><strong>الوصول:</strong> ${booking.check_in}</span> | <span><strong>المغادرة:</strong> ${booking.check_out}</span>
                        </div>
                    </div>
                    <div class="flex flex-col items-end gap-2 self-stretch justify-between w-full sm:w-auto">
                        <div class="text-2xl font-extrabold text-green-600">$${booking.price}</div>
                        <div class="flex gap-2">
                            <button class="bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-bold py-2 px-3 rounded-lg" onclick="window.analyzeBooking(${booking.id})">تحليل AI</button>
                            <button class="bg-red-100 text-red-700 hover:bg-red-200 text-xs font-bold py-2 px-3 rounded-lg" onclick="window.handleDeleteBooking(${booking.id})">إلغاء</button>
                        </div>
                    </div>
                </div>`;
            container.insertAdjacentHTML('beforeend', cardHtml);
        });
    } catch (error) {
        container.innerHTML = `<p class="text-center text-red-500 mt-10">${error.message}</p>`;
    }
<<<<<<< HEAD
}
=======
}
>>>>>>> 9bd2d8d55bf9254d1298665f3a13d2fdb9312f0d
